import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '../../types';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
    isAdmin: false,
  });

  // Cache en mémoire : évite de re-fetcher si déjà chargé
  const profileCache = useRef<Map<string, Profile>>(new Map());

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    // Retourner immédiatement depuis le cache si disponible
    const cached = profileCache.current.get(userId);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('profiles')
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
    // On utilise UNIQUEMENT onAuthStateChange (inclut INITIAL_SESSION)
    // Cela évite le double-fetch que causait getSession() + onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          if (session?.user) {
            const profile = await fetchProfile(session.user.id);
            setAuthState({
              user: session.user,
              profile,
              session,
              loading: false,
              isAdmin: profile?.role === 'admin',
            });
          } else {
            setAuthState({ user: null, profile: null, session: null, loading: false, isAdmin: false });
          }
        } else if (event === 'SIGNED_OUT') {
          profileCache.current.clear();
          setAuthState({ user: null, profile: null, session: null, loading: false, isAdmin: false });
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Pas besoin de re-fetcher le profil, juste mettre à jour la session
          setAuthState(prev => ({ ...prev, session }));
        }
      }
    );

    return () => subscription.unsubscribe();
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

    if (profile.role !== 'admin') {
      await supabase.auth.signOut();
      throw new Error(`Accès refusé. Rôle actuel : "${profile.role}". Rôle requis : "admin".`);
    }

    return { user: data.user, profile };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { ...authState, signIn, signOut };
}
