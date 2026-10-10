import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import '../../../../styles/routes/flatmates.css';
import { getMyFlatmatePost } from '../../../../services/flatmateService.js';
import { useFlatmateSupply } from '../../flatmates/useFlatmateSupply.jsx';
import { useGroupPickers } from '../../flatmates/useGroupPickers.js';
import SupplyModals from '../../flatmates/SupplyModals.jsx';

const noop = () => {};
const ownsNothing = () => false;

export function useFlatmateEditing({ user, toast, refresh }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [myPost, setMyPost] = useState(null);
  const [pendingPostId, setPendingPostId] = useState(null);
  const supply = useFlatmateSupply({
    refresh, user, authLoading: false, toast, t, nav: navigate,
    setInterests: noop, ownsGroup: ownsNothing, myPost, myPostsStatus: 'ready',
    onGroupEdited: noop,
  });
  const pickers = useGroupPickers(user, supply.groupOpen);

  useEffect(() => {
    if (!pendingPostId || myPost?.id !== pendingPostId) return;
    setPendingPostId(null);
    supply.openPostModal(pendingPostId);
  }, [pendingPostId, myPost]); // eslint-disable-line react-hooks/exhaustive-deps -- draft reset only follows the active post

  const editPost = async (id) => {
    try {
      const post = await getMyFlatmatePost(id);
      setMyPost(post);
      setPendingPostId(post.id);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
    }
  };

  const modals = (
    <div className="sf-page">
      <SupplyModals s={{ ...supply, ...pickers, toast, t }} />
    </div>
  );
  return { editGroup: supply.editGroup, editPost, modals };
}
