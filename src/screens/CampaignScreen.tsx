import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '../lib/config';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { Bar, Segmented, Sheet, Spinner } from '../components/ui';
import { useCommuneDrains } from '../lib/communeDrains';
import { download, recordCenter } from '../lib/export';
import { cachedBanStreets, fetchBanStreets, type BanStreet } from '../lib/ban';
import { cachedCommuneStreets, fetchCommuneStreets, type NamedStreet } from '../lib/overpass';
import { formLink, parseCounts, progressCSV, streetsProgress, streetState } from '../lib/streets';
import { useOnline, useRecords } from '../lib/store';
import { useCommune } from './ProfileScreen';

const STALE_MS = 7 * 86_400_000;
type Filter = 'all' | 'todo' | 'nobody';

/** « Mes rues à relever » : toutes les rues de la commune, leur avancement, et l'inscription pour en cartographier une. */
export function CampaignScreen({ onClose }: { onClose: () => void }) {
  const cfg = getConfig();
  const commune = useCommune();
  const insee = commune?.insee;
  const online = useOnline();
  const records = useRecords();
  const communeDrains = useCommuneDrains(insee);
  const [official, setOfficial] = useState<BanStreet[] | null>(null);
  const [osmStreets, setOsmStreets] = useState<NamedStreet[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [notice, setNotice] = useState(false);
  const [limit, setLimit] = useState(40);

  // Liste officielle des voies (Base Adresse Nationale) + tracés OpenStreetMap pour mesurer l'avancement.
  useEffect(() => {
    if (!insee) return;
    let alive = true;
    const load = async <T extends { at: number }, R>(cached: () => Promise<T | undefined>, fetchFresh: () => Promise<R>, apply: (c: T) => void, applyFresh: (r: R) => void, required: boolean) => {
      const c = await cached();
      if (!alive) return;
      if (c) apply(c);
      if ((!c || Date.now() - c.at > STALE_MS) && navigator.onLine !== false) {
        try {
          const r = await fetchFresh();
          if (alive) applyFresh(r);
        } catch {
          if (alive && !c && required) setFailed(true);
        }
      }
    };
    void load(() => cachedBanStreets(insee), () => fetchBanStreets(insee), (c) => setOfficial(c.streets), (r) => { setOfficial(r); setFailed(false); }, true);
    void load(() => cachedCommuneStreets(insee), () => fetchCommuneStreets(insee), (c) => setOsmStreets(c.streets), (r) => setOsmStreets(r), false);
    return () => {
      alive = false;
    };
  }, [insee]);

  // Compteurs publics d'inscrits par rue (aucune donnée personnelle).
  useEffect(() => {
    if (!cfg.campaign.statsUrl) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    fetch(cfg.campaign.statsUrl, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCounts(parseCounts(j)))
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [cfg.campaign.statsUrl]);

  const progress = useMemo(
    () => (official ? streetsProgress(official, osmStreets, [...communeDrains, ...(records || []).map(recordCenter)], counts) : []),
    [official, osmStreets, communeDrains, records, counts],
  );
  const done = progress.filter((p) => streetState(p) === 'done').length;
  const needle = query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  const shown = useMemo(
    () =>
      progress
        .filter((p) => (needle ? p.key.includes(needle) : true))
        .filter((p) => (filter === 'todo' ? streetState(p) !== 'done' : filter === 'nobody' ? streetState(p) !== 'done' && !p.volunteers : true)),
    [progress, needle, filter],
  );

  return (
    <div className="wizard-modal" role="dialog" aria-modal="true" aria-label={t('campaign.title')}>
      <button className="icon-btn wizard-close" onClick={onClose} aria-label={t('common.close')}>
        <Icon name="close" stroke={2.4} />
      </button>
      <div className="wizard">
        <div className="wizard-art" aria-hidden="true" style={{ fontSize: 40 }}>
          🏘️
        </div>
        <h1 className="title1 center">{t('campaign.title')}</h1>
        <p className="subhead secondary center" style={{ margin: 0 }}>
          {t('campaign.intro')}
        </p>

        {official && (
          <div className="card stack">
            <div className="row footnote">
              <span style={{ fontWeight: 600 }}>{t('campaign.summary', { done, total: progress.length })}</span>
            </div>
            <Bar progress={progress.length ? done / progress.length : 0} color="linear-gradient(90deg, var(--accent), var(--teal))" />
          </div>
        )}

        <input
          className="text-input"
          type="search"
          inputMode="search"
          placeholder={t('campaign.search')}
          aria-label={t('campaign.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(40);
          }}
        />
        <Segmented<Filter>
          label={t('campaign.filter')}
          value={filter}
          onChange={setFilter}
          options={(['all', 'todo', 'nobody'] as Filter[]).map((f) => ({ value: f, label: t(`campaign.filter_${f}`) }))}
        />

        {!official && !failed && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner size={28} />
            <p className="footnote secondary">{t('campaign.loading')}</p>
          </div>
        )}
        {failed && (
          <div className="card row">
            <Icon name="warning" style={{ color: 'var(--orange)', flex: 'none' }} />
            <span className="footnote">{online ? t('campaign.failed') : t('campaign.offline')}</span>
          </div>
        )}
        {official && !shown.length && <p className="subhead secondary center">{t('campaign.none')}</p>}

        <ul className="street-list">
          {shown.slice(0, limit).map((p) => {
            const state = streetState(p);
            const chosen = picked.includes(p.name);
            return (
              <li key={p.key} className={`card street-row ${chosen ? 'chosen' : ''}`}>
                <div className="row" style={{ alignItems: 'baseline' }}>
                  <span className="headline" style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  {state === 'unknown' ? (
                    <span className="chip">{t('campaign.unknown')}</span>
                  ) : (
                    <span className={`chip ${state === 'done' ? 'green' : ''}`}>{state === 'done' ? `✓ ${t('campaign.done')}` : `${Math.round((p.ratio ?? 0) * 100)} %`}</span>
                  )}
                </div>
                {p.ratio !== null && <Bar progress={p.ratio} height={6} color={state === 'done' ? 'var(--green)' : 'var(--accent)'} />}
                <div className="row footnote secondary">
                  <span style={{ flex: 1 }}>
                    {p.volunteers ? t('campaign.volunteers', { count: p.volunteers }) : cfg.campaign.statsUrl ? t('campaign.nobody') : ''}
                  </span>
                  {cfg.campaign.formUrl && state !== 'done' && (
                    <button
                      className={`btn small ${chosen ? '' : 'tinted'}`}
                      aria-pressed={chosen}
                      onClick={() => setPicked(chosen ? picked.filter((n) => n !== p.name) : [...picked, p.name])}
                    >
                      {chosen ? `✓ ${t('campaign.chosen')}` : t('campaign.choose')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {shown.length > limit && (
          <button className="btn gray" onClick={() => setLimit(limit + 40)}>
            {t('campaign.more', { count: shown.length - limit })}
          </button>
        )}

        {picked.length > 0 && (
          <div className="sticky-cta">
            <a className="btn" href={formLink(cfg.campaign.formUrl, cfg.campaign.streetEntry, picked)} target="_blank" rel="noopener noreferrer">
              {t('campaign.join', { count: picked.length })}
            </a>
          </div>
        )}

        {!cfg.campaign.formUrl && <p className="section-footer center">{t('campaign.soon')}</p>}
        <button className="btn plain" onClick={() => setNotice(true)}>
          <Icon name="lock" size={16} /> {t('campaign.privacyLink')}
        </button>
        {official && (
          <button className="btn plain" onClick={() => download('avancement_rues.csv', progressCSV(progress), 'text/csv;charset=utf-8')}>
            <Icon name="download" size={16} /> {t('campaign.exportCsv')}
          </button>
        )}
      </div>

      <Sheet open={notice} onClose={() => setNotice(false)} title={t('campaign.privacyTitle')} elevated>
        <div className="stack" style={{ gap: 10 }}>
          <p className="subhead" style={{ margin: 0 }}>{t('campaign.privacyWho', { commune: commune?.name || cfg.commune.name || '' })}</p>
          <p className="subhead" style={{ margin: 0 }}>{t('campaign.privacyWhat')}</p>
          <p className="subhead" style={{ margin: 0 }}>{t('campaign.privacyWhy')}</p>
          <p className="subhead" style={{ margin: 0 }}>{t('campaign.privacyKeep')}</p>
          <p className="subhead" style={{ margin: 0 }}>{t('campaign.privacyRights')}</p>
          <p className="footnote secondary" style={{ margin: 0 }}>{t('campaign.privacyPublic')}</p>
          {cfg.campaign.contactEmail && (
            <a className="btn gray" href={`mailto:${cfg.campaign.contactEmail}`}>{cfg.campaign.contactEmail}</a>
          )}
          {cfg.campaign.privacyUrl && (
            <a className="btn plain" href={cfg.campaign.privacyUrl} target="_blank" rel="noopener noreferrer">{t('campaign.privacyFull')}</a>
          )}
        </div>
      </Sheet>
    </div>
  );
}
