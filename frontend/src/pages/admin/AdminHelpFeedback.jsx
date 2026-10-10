import { useEffect, useState } from 'react';
import { listHelpFeedbackArticles, listHelpFeedbackComments } from '../../services/contentService.js';
import { classNames, fmtAgo, fmtNum } from '../../lib/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, ClearFilters, PageNav, QueuePanel, QueueTabs, RowCard, RowList,
} from '../../components/admin/WorkQueue.jsx';

const PAGE_SIZE = 20;
const TABS = [{ key: 'articles', label: 'Articles' }, { key: 'comments', label: 'Comments' }];
const LANG = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
const EMPTY = { items: [], total: 0, totalPages: 0 };

const Dot = () => <span className="text-gray-600" aria-hidden="true">{'\u00b7'}</span>;
const Lang = ({ lang }) => <span className={classNames(CHIP, CHIP_TONE.neutral)}>{LANG[lang] || lang}</span>;

function ArticleRow({ a, onComments }) {
  const votes = a.helpful + a.notHelpful;
  const share = votes ? Math.round((100 * a.notHelpful) / votes) : 0;
  return (
    <RowCard
      id={`${a.slug}:${a.lang}`}
      testId="help-feedback-article"
      title={a.slug}
      badges={<Lang lang={a.lang} />}
      meta={(
        <>
          <span>{fmtNum(a.helpful)} helpful</span><Dot />
          <span className={a.notHelpful ? 'text-rose-300' : undefined}>{fmtNum(a.notHelpful)} not helpful</span><Dot />
          <span>{share}% not helpful</span><Dot />
          <span>{fmtNum(a.comments)} {a.comments === 1 ? 'comment' : 'comments'}</span>
          {a.lastAt ? <><Dot /><span title={a.lastAt}>{fmtAgo(a.lastAt)}</span></> : null}
        </>
      )}
      primary={a.comments ? <button type="button" onClick={() => onComments(a.slug)} className={BTN.ghost}>Read comments</button> : null}
    />
  );
}

function CommentRow({ c }) {
  return (
    <RowCard
      id={c.id}
      testId="help-feedback-comment"
      title={c.slug}
      badges={(
        <>
          <Lang lang={c.lang} />
          <span className={classNames(CHIP, CHIP_TONE[c.helpful ? 'green' : 'red'])}>{c.helpful ? 'Helpful' : 'Not helpful'}</span>
        </>
      )}
      meta={<span title={c.createdAt}>{fmtAgo(c.createdAt)}</span>}
      chips={<p className="min-w-0 whitespace-pre-wrap break-words text-sm text-gray-200">{c.comment}</p>}
    />
  );
}

export default function AdminHelpFeedback() {
  const [tab, setTab] = useState('articles');
  const [slug, setSlug] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    let alive = true;
    setData((prev) => (prev ? { ...prev, stale: true } : prev));
    const query = { page: page - 1, size: PAGE_SIZE };
    const read = tab === 'articles' ? listHelpFeedbackArticles(query) : listHelpFeedbackComments({ ...query, slug });
    read
      .then((res) => { if (alive) { setFailed(''); setData({ ...res, tab }); } })
      .catch((err) => { if (alive) { setFailed(err?.message || 'Could not load help feedback'); setData({ ...EMPTY, tab }); } });
    return () => { alive = false; };
  }, [tab, slug, page]);

  const show = (next, nextSlug = '') => { setTab(next); setSlug(nextSlug); setPage(1); };

  if (!data) return <Loading />;

  return (
    <div>
      <PageHeader title="Help feedback" subtitle="How readers rate each help article, and what they wrote. Articles with 5 or more votes come first, by share not helpful." />
      <QueueTabs tabs={TABS} active={tab} onChange={(key) => show(key)} label="Help feedback" idPrefix="help-feedback" />
      {failed ? <div role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{failed}</div> : null}
      <QueuePanel
        idPrefix="help-feedback"
        active={tab}
        note={tab === 'comments' && slug ? `Comments on ${slug}` : null}
        toolbar={(
          <>
            {tab === 'comments' && slug ? <ClearFilters onClick={() => show('comments')} /> : null}
            <div className="ml-auto">
              <PageNav
                page={page}
                pageCount={Math.max(1, data.totalPages || 1)}
                total={data.total || 0}
                size={PAGE_SIZE}
                onPage={setPage}
                stale={data.stale || data.tab !== tab}
              />
            </div>
          </>
        )}
      >
        {data.tab !== tab ? <Loading /> : (
          <RowList isEmpty={!data.items.length} empty={tab === 'articles' ? 'No feedback yet.' : 'No comments yet.'}>
            {data.items.map((row) => (tab === 'articles'
              ? <ArticleRow key={`${row.slug}:${row.lang}`} a={row} onComments={(s) => show('comments', s)} />
              : <CommentRow key={row.id} c={row} />))}
          </RowList>
        )}
      </QueuePanel>
    </div>
  );
}
