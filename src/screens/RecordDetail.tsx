import { useEffect, useState } from 'react';
import { formatDate, formatNumber, t } from '../i18n';
import { Icon } from '../components/Icon';
import { MapView } from '../components/MapView';
import { Sheet, Spinner, Stars, toast } from '../components/ui';
import { getPhoto, type DrainRecord, type StepStatus } from '../lib/db';
import { deleteRecordEverywhere, processDeletions } from '../lib/deletions';
import { panoramaxReady } from '../lib/panoramax';
import { shortAddress } from '../lib/geocode';
import { osmElementUrl } from '../lib/osm';
import { recordCenter, recordLength } from '../lib/export';
import { pictureViewerUrl } from '../lib/panoramax';
import { useAuth, useRecords } from '../lib/store';
import { resetErrors, syncNow } from '../lib/sync';
import { isOsmMappable, osmTags } from '../lib/taxonomy';

export function statusChip(status: StepStatus, error?: string) {
  const map: Record<StepStatus, string> = { pending: 'orange', running: 'blue', done: 'green', error: 'red', skipped: '' };
  return (
    <span className={`chip ${map[status]}`} title={error}>
      {t(`status.${status}`)}
    </span>
  );
}

export function usePhotoUrl(id: string, which: 'blob' | 'thumb' = 'thumb') {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    let alive = true;
    void getPhoto(id).then((p) => {
      if (!p || !alive) return;
      u = URL.createObjectURL(p[which]);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, which]);
  return url;
}

export function RecordDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const records = useRecords();
  const rec = records?.find((r) => r.id === id);
  const photo = usePhotoUrl(id, 'blob');
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const auth = useAuth();
  const connectedBoth = !!auth.osm && panoramaxReady();
  if (!rec) return null;
  const published = rec.sync.osm.status === 'done' || rec.sync.panoramax.status === 'done';
  const hasError = rec.sync.osm.status === 'error' || rec.sync.panoramax.status === 'error';

  return (
    <div className="stack">
      <div className="detail-hero">
        {photo ? <img src={photo} alt={t('records.photoAlt')} /> : <div className="skeleton" style={{ height: '100%' }} />}
      </div>
      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="headline">{t(`types.${rec.details.type}.name`)}</div>
          <div className="footnote secondary">
            {formatDate(rec.createdAt)} · {shortAddress(rec.address) || t('review.noAddress')}
          </div>
        </div>
        <Stars value={rec.quality.stars} />
      </div>

      <div className="detail-map">
        <MapView
          center={recordCenter(rec)}
          zoom={rec.line ? 20 : 19}
          layer="ortho"
          interactive={false}
          markers={rec.line ? [] : [{ id: rec.id, lat: rec.position.lat, lon: rec.position.lon, kind: 'mine' }]}
          lines={rec.line ? [{ id: rec.id, points: [rec.line.a, rec.line.b], kind: 'mine' }] : undefined}
        />
      </div>

      <div className="list">
        <div className="list-row">
          <span>{t('review.precision')}</span>
          <span className="value">± {formatNumber(rec.position.acc, 1)} m</span>
        </div>
        {rec.line && (
          <div className="list-row">
            <span>{t('review.length')}</span>
            <span className="value">≈ {recordLength(rec)} m</span>
          </div>
        )}
        <div className="list-row">
          <span>{t('records.points')}</span>
          <span className="value rounded-num">
            {rec.points + (rec.bonusAwarded ? 5 : 0)} {t('common.pts')}
          </span>
        </div>
        <div className="list-row">
          <span className="icon-tile" style={{ background: '#c6a96b' }}>
            <Icon name="photo" size={16} />
          </span>
          <span style={{ flex: 1 }}>Panoramax</span>
          {rec.sync.panoramax.status === 'done' ? (
            <a href={pictureViewerUrl(rec.sync.panoramax.pictureId)} target="_blank" rel="noopener" className="row" style={{ gap: 4 }}>
              {statusChip('done')} <Icon name="external" size={16} />
            </a>
          ) : (
            statusChip(rec.sync.panoramax.status, rec.sync.panoramax.error)
          )}
        </div>
        <div className="list-row">
          <span className="icon-tile" style={{ background: '#7ebc6f' }}>
            <Icon name="map" size={16} />
          </span>
          <span style={{ flex: 1 }}>OpenStreetMap</span>
          {rec.sync.osm.status === 'done' && rec.sync.osm.osmId ? (
            <a href={osmElementUrl(rec.sync.osm.osmType ?? 'node', rec.sync.osm.osmId)} target="_blank" rel="noopener" className="row" style={{ gap: 4 }}>
              {statusChip('done')} <Icon name="external" size={16} />
            </a>
          ) : (
            statusChip(rec.sync.osm.status, rec.sync.osm.error)
          )}
        </div>
      </div>
      {(rec.sync.osm.error || rec.sync.panoramax.error) && (
        <p className="footnote secondary" style={{ margin: '0 4px' }}>
          <Icon name="info" size={14} style={{ verticalAlign: '-2px' }} />{' '}
          {errorText(rec)}
        </p>
      )}
      {isOsmMappable(rec.details.type) && (
        <pre className="tags-code selectable" style={{ borderRadius: 12 }}>
          {Object.entries(osmTags(rec.details, rec.sync.panoramax.status === 'done' ? rec.sync.panoramax.pictureId : undefined))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')}
        </pre>
      )}

      {hasError && (
        <button
          className="btn tinted"
          onClick={async () => {
            await resetErrors(rec.id);
            void syncNow({ manual: true });
          }}
        >
          <Icon name="sync" /> {t('records.retry')}
        </button>
      )}
      <button className="btn danger" onClick={() => setConfirm(true)}>
        <Icon name="trash" /> {t('records.delete')}
      </button>

      <Sheet open={confirm} onClose={() => setConfirm(false)} elevated>
        <div className="stack center">
          <h2 className="title3">{t('records.deleteTitle')}</h2>
          <p className="subhead secondary" style={{ margin: 0 }}>{published ? t('records.deletePublished') : t('records.deleteText')}</p>
          {published && (
            <p className="footnote secondary" style={{ margin: 0 }}>
              {rec.mode === 'enrich' ? t('records.deleteEnrich') : t('records.deleteShared')}
              {!connectedBoth && ` ${t('records.deleteOffline')}`}
            </p>
          )}
          <button
            className="btn danger"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                const remote = await deleteRecordEverywhere(rec);
                const left = remote ? (await processDeletions()).remaining : 0;
                toast(left ? t('records.deletedPending') : remote ? t('records.deletedEverywhere') : t('records.deleted'), 'trash', 'var(--red)');
              } finally {
                setDeleting(false);
                setConfirm(false);
                onDeleted();
              }
            }}
          >
            {deleting ? <Spinner /> : null}
            {t('records.delete')}
          </button>
          <button className="btn gray" disabled={deleting} onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function errorText(rec: DrainRecord): string {
  const err = rec.sync.osm.error || rec.sync.panoramax.error || '';
  const known = ['osm_rate_limited', 'osm_auth', 'panoramax_auth', 'network', 'not_mappable', 'no_photo', 'offline'];
  return known.includes(err) ? t(`errors.${err}`) : t('errors.generic', { error: err });
}
