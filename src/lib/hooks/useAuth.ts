import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '../../types';
import { can, type Permission, type Role } from '../permissions';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isModerator: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
    isAdmin: false,
    isSuperAdmin: false,
    isModerator: false,
  });

  // Cache en mémoire : évite de re-fetcher si déjà chargé
  const profileCache = useRef<Map<string, Profile>>(new Map());

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    // Retourner immédiatement depuis le cache si disponible
    const cached = profileCache.current.get(userId);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, username, email, avatar_url, role, coins, is_blocked, created_at, last_seen')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('[fetchProfile] error:', error.code, error.message);
      return null;
    }

    if (data) {
      profileCache.current.set(userId, data as Profile);
    }

    return data as Profile | null;
  }, []);

  useEffect(() => {
    let mounted = true;

    // Helper pour appliquer une session
    const applySession = async (session: Session | null) => {
      if (!mounted) return;
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        if (!mounted) return;
        setAuthState({
          user: session.user,
          profile,
          session,
          loading: false,
          isAdmin: profile?.role === 'admin' || profile?.role === 'super_admin',
          isSuperAdmin: profile?.role === 'super_admin',
          isModerator: profile?.role === 'moderator',
        });
      } else {
        setAuthState({ user: null, profile: null, session: null, loading: false, isAdmin: false, isSuperAdmin: false, isModerator: false });
      }
    };

    // 1) Lecture immédiate de la session existante (résout loading rapidement)
    supabase.auth.getSession()
      .then(({ data }) => applySession(data.session))
      .catch(err => {
        console.error('[useAuth] getSession failed:', err);
        if (mounted) {
          setAuthState(prev => ({ ...prev, loading: false }));
        }
      });

    // 2) Safety net : si dans 5s rien ne se résout, on force loading=false
    //    → évite l'écran "Chargement…" infini si Supabase a un hiccup
    const safetyTimer = setTimeout(() => {
      if (!mounted) return;
      setAuthState(prev => (prev.loading ? { ...prev, loading: false } : prev));
    }, 5000);

    // 3) Listener pour les changements d'auth ultérieurs
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          await applySession(session);
        } else if (event === 'SIGNED_OUT') {
          profileCache.current.clear();
          setAuthState({ user: null, profile: null, session: null, loading: false, isAdmin: false, isSuperAdmin: false, isModerator: false });
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          setAuthState(prev => ({ ...prev, session }));
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // On fetche une seule fois et on met en cache
    // onAuthStateChange utilisera ensuite le cache → 0 requête supplémentaire
    const profile = await fetchProfile(data.user.id);

    if (!profile) {
      await supabase.auth.signOut();
      throw new Error(
        `Profil introuvable (id: ${data.user.id}). ` +
        `Vérifiez la table "profiles" dans Supabase.`
      );
    }

    if (profile.role !== 'admin' && profile.role !== 'super_admin' && profile.role !== 'moderator') {
      await supabase.auth.signOut();
      throw new Error(`Accès refusé. Rôle actuel : "${profile.role}". Rôle requis : admin, super_admin ou moderator.`);
    }

    return { user: data.user, profile };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  /**
   * Vérifie si l'utilisateur courant a une permission donnée.
   * Returns false si non authentifié ou role inconnu.
   */
  const hasPerm = useCallback((perm: Permission): boolean => {
    return can(authState.profile?.role as Role | undefined, perm);
  }, [authState.profile?.role]);

  return { ...authState, signIn, signOut, hasPerm };
}
