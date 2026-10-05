import { Navigate, useLocation, useParams } from 'react-router';

export default function LegacyHelpLangRedirect() {
  const { '*': rest } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/help${rest ? `/${rest}` : ''}${search}${hash}`} replace />;
}