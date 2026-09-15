import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { gateReason, signInPath } from './authIntent.js';

/**
 * One answer to "a signed-out visitor clicked something that needs an account": say why, then take
 * them there — and while the session is still restoring, defer rather than deny (hence the return).
 */
export function useSignInGate() {
  const { loading } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  return useCallback((reason, next) => {
    if (loading) {
      toast(t('auth.gateChecking'), 'info');
      return false;
    }
    toast(t(`auth.intent.${gateReason(reason)}Heading`), 'info');
    navigate(signInPath(reason, next));
    return true;
  }, [loading, navigate, t, toast]);
}
