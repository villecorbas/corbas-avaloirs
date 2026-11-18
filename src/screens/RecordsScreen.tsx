import { useMemo, useState } from 'react';
import { formatDate, formatRelative, t } from '../i18n';
import { Icon } from '../components/Icon';
import { Sheet, Spinner } from '../components/ui';
import { needsSync, dayKey } from '../lib/gamification';
import { shortAddress } from '../lib/geocode';
import { panoramaxReady } from '../lib/panoramax';
import { useAuth, useOnline, useProgress, useRecords } from '../lib/store';
import { resetErrors, syncNow, useSyncState } from '../lib/sync';
import type { DrainRecord } from '../lib/db';
import { RecordDetail, usePhotoUrl } from './RecordDetail';

export function RecordsScreen({ onOpenAccounts, onAdd }: { onOpenAccounts: () => void; onAdd: () => void }) {
  const records = useRecords();
  const progress = useProgress();
  const auth = useAuth();
  const online = useOnline();
  const sync = useSyncState();
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, DrainRecord[]>();
    for (const r of records || []) {
      const k = dayKey(r.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()];
  }, [records]);

  const connected = !!auth.osm && panoramaxReady();

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="large-title">{t('records.title')}</h1>
      </header>

      <div className="card stats-card">
        <Stat value={progress.count} label={t('records.statTotal')} />
        <Stat value={progress.published} label={t('records.statPublished')} color="var(--green)" />
        <Stat value={progress.pending} label={t('records.statPending')} color={progress.pending ? 'var(--orange)' : undefined} />
      </div>

      {progress.pending > 0 && (
        <div className="card stack" style={{ marginTop: 12 }}>
          {!connected ? (
            <>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Icon name="cloudUp" size={26} style={{ color: 'var(--blue)', flex: 'none' }} />
                <div>
                  <div className="headline">{t('records.connectTitle')}</div>
                  <div className="footnote secondary">{t('records.connectText', { count: progress.pending })}</div>
                </div>
              </div>
              <button className="btn" onClick={onOpenAccounts}>
                {t('records.connect')}
              </button>
            </>
          ) : (
            <>
              <div className="row">
                {sync.running ? <Spinner /> : <Icon name="cloudUp" style={{ color: 'var(--accent)' }} />}
                <div style={{ flex: 1 }}>
                  <div className="headline">
                    {sync.running ? t('sync.running', { done: sync.done, total: sync.total }) : t('records.pendingCount', { count: progress.pending })}
                  </div>
                  <div className="footnote secondary">
                    {!online
                      ? t('errors.offline')
                      : sync.lastError
                        ? t(`errors.${['osm_rate_limited', 'osm_auth', 'panoramax_auth', 'network', 'offline'].includes(sync.lastError) ? sync.lastError : 'generic'}`, { error: sync.lastError })
                        : sync.lastRun
                          ? t('records.lastSync', { when: formatRelative(sync.lastRun) })
                          : t('records.autoSync')}
                  </div>
                </div>
              </div>
              <button
                className="btn tinted"
                disabled={sync.running || !online}
                onClick={async () => {
                  await resetErrors();
                  void syncNow({ manual: true });
                }}
              >
                <Icon name="sync" /> {t('records.syncNow')}
              </button>
            </>
          )}
        </div>
      )}

      {records && records.length === 0 && (
        <div className="empty">
          <div className="empty-art">
            <Icon name="grate" size={44} />
          </div>
          <h2 className="title3">{t('records.emptyTitle')}</h2>
          <p className="subhead secondary">{t('records.emptyText')}</p>
          <button className="btn" onClick={onAdd} style={{ maxWidth: 280 }}>
            <Icon name="plus" stroke={2.6} /> {t('map.add')}
          </button>
        </div>
      )}

      {groups.map(([day, list]) => (
        <section key={day}>
          <h3 className="section-title">{formatDate(list[0].createdAt, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          <div className="list">
            {list.map((r) => (
              <RecordRow key={r.id} rec={r} onClick={() => setOpen(r.id)} />
            ))}
          </div>
        </section>
      ))}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={t('records.detailTitle')}>
        {open && <RecordDetail id={open} onDeleted={() => setOpen(null)} />}
      </Sheet>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="stat">
      <span className="title1 rounded-num" style={{ color }}>
        {value}
      </span>
      <span className="caption secondary">{label}</span>
    </div>
  );
}

function RecordRow({ rec, onClick }: { rec: DrainRecord; onClick: () => void }) {
  const thumb = usePhotoUrl(rec.id);
  const pending = needsSync(rec);
  const error = rec.sync.osm.status === 'error' || rec.sync.panoramax.status === 'error';
  return (
    <button className="list-row record-row" onClick={onClick} style={{ ['--inset' as string]: '78px' }}>
      <div className="record-thumb">{thumb ? <img src={thumb} alt="" /> : null}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="headline ellipsis">{t(`types.${rec.details.type}.name`)}</div>
        <div className="footnote secondary ellipsis">
          {formatDate(rec.createdAt, { timeStyle: 'short' })} · {shortAddress(rec.address) || `± ${Math.round(rec.position.acc)} m`}
        </div>
      </div>
      {error ? (
        <span className="chip red">{t('status.error')}</span>
      ) : pending ? (
        <span className="chip orange">{t('status.pending')}</span>
      ) : (
        <span className="chip green">
          <Icon name="check" size={13} stroke={3} />
          {t('status.published')}
        </span>
      )}
      <Icon name="chevron" size={16} className="chev" />
    </button>
  );
}
