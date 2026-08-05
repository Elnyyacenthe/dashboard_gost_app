// ============================================================
// Compression des images à l'upload (CMS)
// ============================================================
// Toute image passée au CMS est ré-encodée en JPEG dans le navigateur avant
// d'être envoyée dans le bucket `cms`. Les affiches sortaient de l'export
// graphique en PNG : ~2,4 Mo pièce pour un visuel 1530×950, soit ~12 Mo à
// télécharger juste pour afficher l'accueil de l'app, sur des connexions
// mobiles camerounaises. Les mêmes visuels en JPEG q=0.85 pèsent ~10 fois
// moins pour une différence invisible à l'œil sur une affiche photo.
//
// Deux garde-fous, parce qu'un convertisseur qui dégrade sans prévenir est
// pire que pas de convertisseur :
//   • une image AVEC TRANSPARENCE n'est pas convertie en JPEG (le JPEG n'a
//     pas de canal alpha : les zones transparentes deviendraient noires ou
//     blanches). Elle part en WebP, qui garde l'alpha et compresse mieux que
//     le PNG ;
//   • si le résultat n'est pas plus léger que l'original, on garde
//     l'original. Ré-encoder un JPEG déjà optimisé ne fait qu'ajouter des
//     artefacts.
//
// Les dimensions mesurées ici sont remontées à l'appelant : le carousel de
// l'app s'en sert pour caler sa hauteur sur celle des affiches.

/** Largeur/hauteur max. Au-delà, l'image est réduite (Lanczos du navigateur). */
const MAX_EDGE = 1920;
/** Qualité JPEG initiale. */
const QUALITY = 0.85;
/** Qualité plancher si l'image reste lourde après un premier passage. */
const MIN_QUALITY = 0.62;
/** Au-delà, on retente avec une qualité plus basse. */
const TARGET_BYTES = 500 * 1024;

export interface CompressedImage {
  /** Fichier à uploader — l'original si la conversion n'apporte rien. */
  file: File;
  width: number;
  height: number;
  /** Taille du fichier d'origine, pour l'affichage du gain. */
  originalBytes: number;
}

/** Formats qu'on ne touche pas : vectoriel, ou animé (le canvas les figerait). */
function isUntouchable(file: File): boolean {
  return file.type === 'image/svg+xml' || file.type === 'image/gif';
}

async function decode(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari ancien : on retombe sur <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible'));
      img.src = url;
    });
  } finally {
    // Révoqué après le chargement : l'élément garde ses pixels décodés.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Vrai si l'image contient au moins un pixel non opaque. Testé sur une
 * réduction 96×96 : suffisant pour repérer un fond transparent ou des coins
 * arrondis, et sans coût mémoire sur une affiche 4K.
 */
function hasAlpha(src: HTMLImageElement | ImageBitmap, w: number, h: number): boolean {
  const probe = document.createElement('canvas');
  const scale = Math.min(96 / w, 96 / h, 1);
  probe.width = Math.max(1, Math.round(w * scale));
  probe.height = Math.max(1, Math.round(h * scale));
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true; // dans le doute, on ne convertit pas en JPEG
  ctx.drawImage(src as CanvasImageSource, 0, 0, probe.width, probe.height);
  try {
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    return true; // canvas "tainted" : on reste prudent
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function renamed(name: string, ext: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.${ext}`;
}

/**
 * Convertit et compresse une image pour le CMS. Ne jette jamais : en cas de
 * problème (format exotique, canvas indisponible), renvoie le fichier
 * d'origine — un upload qui passe mal compressé vaut mieux qu'un upload qui
 * échoue.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const originalBytes = file.size;
  const fallback = (): CompressedImage => ({ file, width: 0, height: 0, originalBytes });

  if (!file.type.startsWith('image/') || isUntouchable(file)) return fallback();

  try {
    const src = await decode(file);
    const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width;
    const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height;
    if (!w0 || !h0) return fallback();

    const scale = Math.min(MAX_EDGE / w0, MAX_EDGE / h0, 1);
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    const transparent = hasAlpha(src, w0, h0);
    const mime = transparent ? 'image/webp' : 'image/jpeg';
    const ext = transparent ? 'webp' : 'jpg';

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    if ('close' in src) src.close();

    let quality = QUALITY;
    let blob = await toBlob(canvas, mime, quality);
    // Une seule relance : sur une affiche très détaillée, q=0.85 peut encore
    // peser plus de 500 Ko. En dessous de MIN_QUALITY les aplats commencent
    // à baver, on s'arrête là plutôt que de dégrader le visuel.
    while (blob && blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.12);
      blob = await toBlob(canvas, mime, quality);
    }

    // Le navigateur n'a pas su encoder ce type (WebP sur très vieux Safari) :
    // toBlob renvoie alors du PNG, souvent plus lourd que l'original.
    if (!blob || blob.size >= originalBytes) {
      return { file, width: w0, height: h0, originalBytes };
    }

    return {
      file: new File([blob], renamed(file.name, ext), { type: blob.type }),
      width: w,
      height: h,
      originalBytes,
    };
  } catch {
    return fallback();
  }
}
