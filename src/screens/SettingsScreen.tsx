import { useState } from 'react';
import { APP_VERSION, getConfig, setConfigOverride } from '../lib/config';
import { formatRelative, LANGS, setLang, t, useLang, type Lang } from '../i18n';
import { Icon, type IconName } from '../components/Icon';
import { Segmented, Sheet, Spinner, toast } from '../components/ui';
import { download, osmDrainsToGeoJSON, recordsToCSV, recordsToGeoJSON } from '../lib/export';
import { cachedCommuneStats, fetchCommuneStats } from '../lib/overpass';
import { isStandalone, useRecords } from '../lib/store';
import { Accounts } from './Accounts';
import { InstallGuide } from './InstallGuide';
import { useCommune } from './ProfileScreen';

function Row({ icon, color, label, value, onClick, href }: { icon: IconName; color: string; label: string; value?: string; onClick?: () => void; href?: string }) {
  const content = (
    <>
      <span className="icon-tile" style={{ background: color }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {value && <span className="value">{value}</span>}
      <Icon name={href ? 'external' : 'chevron'} size={16} className="chev" />
    </>
  );
  return href ? (
    <a className="list-row" href={href} target="_blank" rel="noopener" style={{ color: 'inherit', ['--inset' as string]: '57px' }}>
      {content}
    </a>
  ) : (
    <button className="list-row" onClick={onClick} style={{ ['--inset' as string]: '57px' }}>
      {content}
    </button>
  );
}

export function SettingsScreen({ onInvite }: { onInvite: () => void }) {
  const lang = useLang();
  const records = useRecords() || [];
  const commune = useCommune();
  const [sheet, setSheet] = useState<'install' | 'about' | null>(null);
  const [exporting, setExporting] = useState(false);
  const cfg = getConfig();
  const dev = cfg.openstreetmap.environment === 'dev';
  const stamp = new Date().toISOString().slice(0, 10);

  const exportCommune = async () => {
    if (!commune) return;
    setExporting(true);
    try {
      let stats;
      try {
        stats = await fetchCommuneStats(commune.insee);
      } catch {
        // Serveurs Overpass indisponibles : on se rabat sur les dernières données connues.
        stats = await cachedCommuneStats(commune.insee);
        if (!stats) throw new Error('unavailable');
        toast(t('settings.exportCached', { when: formatRelative(stats.at) }), 'info', 'var(--orange)');
      }
      if (!stats.drains.length) {
        toast(t('settings.exportEmpty'), 'info', 'var(--orange)');
        return;
      }
      download(`avaloirs_osm_${commune.insee}_${stamp}.geojson`, JSON.stringify(osmDrainsToGeoJSON(stats.drains)), 'application/geo+json');
      toast(t('settings.exported', { count: stats.drains.length }), 'check');
    } catch {
      toast(t('settings.exportFailed'), 'warning', 'var(--red)');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="large-title">{t('settings.title')}</h1>
      </header>

      <Accounts />

      <h3 className="section-title">{t('settings.language')}</h3>
      <div className="card" style={{ padding: 10 }}>
        <Segmented<Lang> label={t('settings.language')} value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
      </div>

      <h3 className="section-title">{t('settings.app')}</h3>
      <div className="list">
        {!isStandalone() && <Row icon="download" color="var(--blue)" label={t('settings.install')} onClick={() => setSheet('install')} />}
        <Row icon="qr" color="var(--indigo)" label={t('settings.share')} onClick={onInvite} />
      </div>

      <h3 className="section-title">{t('settings.data')}</h3>
      <div className="list">
        <Row
          icon="download"
          color="var(--accent)"
          label={t('settings.exportGeojson')}
          value={String(records.length)}
          onClick={() => {
            if (!records.length) return toast(t('settings.exportNone'), 'info', 'var(--orange)');
            download(`mes_avaloirs_${stamp}.geojson`, JSON.stringify(recordsToGeoJSON(records), null, 1), 'application/geo+json');
            toast(t('settings.exported', { count: records.length }), 'check');
          }}
        />
        <Row icon="list" color="var(--green)" label={t('settings.exportCsv')} onClick={() => {
            if (!records.length) return toast(t('settings.exportNone'), 'info', 'var(--orange)');
            download(`mes_avaloirs_${stamp}.csv`, recordsToCSV(records), 'text/csv;charset=utf-8');
            toast(t('settings.exported', { count: records.length }), 'check');
          }} />
        {commune && (
          <button className="list-row" onClick={exportCommune} disabled={exporting} style={{ ['--inset' as string]: '57px' }}>
            <span className="icon-tile" style={{ background: 'var(--teal)' }}>
              <Icon name="globe" size={17} />
            </span>
            <span style={{ flex: 1 }}>{t('settings.exportCommune')}</span>
            {exporting ? <Spinner size={18} /> : <Icon name="chevron" size={16} className="chev" />}
          </button>
        )}
      </div>
      <p className="section-footer">{t('settings.dataFooter')}</p>

      <h3 className="section-title">{t('settings.advanced')}</h3>
      <div className="list">
        <label className="list-row" style={{ cursor: 'pointer' }}>
          <span style={{ flex: 1 }}>
            {t('settings.testMode')}
            <span className="footnote secondary" style={{ display: 'block' }}>{t('settings.testModeHint')}</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={dev}
            onChange={(e) => {
              setConfigOverride({ openstreetmap: { ...cfg.openstreetmap, environment: e.target.checked ? 'dev' : 'production' } });
              window.location.reload();
            }}
          />
        </label>
      </div>

      <h3 className="section-title">{t('settings.about')}</h3>
      <div className="list">
        <Row icon="info" color="var(--label-2)" label={t('settings.aboutApp')} value={`v${APP_VERSION}`} onClick={() => setSheet('about')} />
        <Row icon="map" color="#7ebc6f" label={t('settings.osmWiki')} href="https://wiki.openstreetmap.org/wiki/FR:Key:inlet" />
        <Row icon="photo" color="#c6a96b" label="Panoramax" href="https://panoramax.fr" />
      </div>

      <Sheet open={sheet === 'install'} onClose={() => setSheet(null)} title={t('install.title')} elevated>
        <InstallGuide onDone={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'about'} onClose={() => setSheet(null)} title={t('settings.aboutApp')} elevated>
        <div className="stack subhead">
          <p style={{ margin: 0 }}>{t('about.p1')}</p>
          <p style={{ margin: 0 }}>{t('about.p2')}</p>
          <p className="footnote secondary" style={{ margin: 0 }}>{t('about.credits')}</p>
          <p className="footnote secondary" style={{ margin: 0 }}>
            {cfg.campaignName} · v{APP_VERSION} · {t('about.license')}
          </p>
        </div>
      </Sheet>
    </div>
  );
}
