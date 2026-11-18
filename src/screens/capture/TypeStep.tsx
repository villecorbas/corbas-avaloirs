import { t } from '../../i18n';
import { DrainIllustration } from '../../components/DrainIllustration';
import { Icon } from '../../components/Icon';
import { haptic, Segmented } from '../../components/ui';
import {
  channelMode,
  DRAIN_TYPES,
  type DrainDetails,
  type DrainMaterial,
  type DrainShape,
  type DrainType,
  type Observations,
  type TriState,
} from '../../lib/taxonomy';

export function TypeStep({
  photoUrl,
  details,
  observations,
  enrichNote,
  allowedTypes = DRAIN_TYPES,
  onChange,
  onNext,
}: {
  allowedTypes?: DrainType[];
  photoUrl?: string;
  details: Partial<DrainDetails>;
  observations: Observations;
  enrichNote?: boolean;
  onChange: (d: Partial<DrainDetails>, o: Observations) => void;
  onNext: () => void;
}) {
  const select = (type: DrainType) => {
    haptic();
    const next: Partial<DrainDetails> = { ...details, type };
    if (type === 'kerb_opening' || type === 'channel') next.shape = undefined;
    if (type !== 'kerb_opening') next.hasCover = undefined;
    onChange(next, observations);
  };
  const tri = (v: TriState | undefined, key: keyof Observations) => (value: TriState) =>
    onChange(details, { ...observations, [key]: v === value ? undefined : value });

  return (
    <div className="step-scroll">
      <div className="type-header">
        {photoUrl && <img src={photoUrl} alt="" className="type-thumb" />}
        <div>
          <h1 className="title1">{t('type.title')}</h1>
          <p className="subhead secondary" style={{ margin: '2px 0 0' }}>{t('type.subtitle')}</p>
        </div>
      </div>
      {enrichNote && (
        <div className="card row" style={{ marginBottom: 12, background: 'var(--accent-tint)' }}>
          <Icon name="info" style={{ color: 'var(--accent)', flex: 'none' }} />
          <span className="footnote">{t('type.enrichNote')}</span>
        </div>
      )}

      <div className="type-grid" role="radiogroup" aria-label={t('type.title')}>
        {allowedTypes.map((type) => {
          const selected = details.type === type;
          return (
            <button
              key={type}
              role="radio"
              aria-checked={selected}
              className={`type-card ${selected ? 'selected' : ''} ${type === 'generic' ? 'wide' : ''}`}
              onClick={() => select(type)}
            >
              <DrainIllustration type={type} />
              <span className="type-name">{t(`types.${type}.name`)}</span>
              <span className="type-desc">{t(`types.${type}.desc`)}</span>
              {selected && (
                <span className="type-check pop">
                  <Icon name="check" size={16} stroke={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {details.type === 'channel' && (
        <p className="section-footer slide-in" style={{ marginTop: 10 }}>
          <Icon name="info" size={14} style={{ verticalAlign: '-2px' }} /> {t(`types.channel.osmNote_${channelMode()}`)}
        </p>
      )}

      {details.type && (
        <div className="slide-in">
          <h3 className="section-title">{t('type.detailsTitle')}</h3>
          <div className="card stack">
            {details.type !== 'kerb_opening' && details.type !== 'channel' && (
              <Field label={t('type.shape')}>
                <Segmented<DrainShape>
                  label={t('type.shape')}
                  value={details.shape}
                  onChange={(v) => onChange({ ...details, shape: details.shape === v ? undefined : v }, observations)}
                  options={[
                    { value: 'rectangular', label: t('shape.rectangular') },
                    { value: 'square', label: t('shape.square') },
                    { value: 'circular', label: t('shape.circular') },
                  ]}
                />
              </Field>
            )}
            <Field label={t('type.material')}>
              <Segmented<DrainMaterial>
                label={t('type.material')}
                value={details.material}
                onChange={(v) => onChange({ ...details, material: details.material === v ? undefined : v }, observations)}
                options={[
                  { value: 'metal', label: t('material.metal') },
                  { value: 'concrete', label: t('material.concrete') },
                ]}
              />
            </Field>
            {details.type === 'kerb_opening' && (
              <label className="toggle-row">
                <span className="subhead">{t('type.hasCover')}</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={!!details.hasCover}
                  onChange={(e) => onChange({ ...details, hasCover: e.target.checked }, observations)}
                />
              </label>
            )}
          </div>
          <p className="section-footer">{t('type.detailsFooter')}</p>

          <h3 className="section-title">{t('type.obsTitle')}</h3>
          <div className="card stack">
            <Field label={t('obs.standingWater')} icon="drop">
              <Segmented<TriState>
                label={t('obs.standingWater')}
                value={observations.standingWater}
                onChange={tri(observations.standingWater, 'standingWater')}
                options={[
                  { value: 'yes', label: t('common.yes') },
                  { value: 'no', label: t('common.no') },
                  { value: 'unknown', label: t('common.dontKnow') },
                ]}
              />
            </Field>
            <Field label={t('obs.clogged')} icon="warning">
              <Segmented<TriState>
                label={t('obs.clogged')}
                value={observations.clogged}
                onChange={tri(observations.clogged, 'clogged')}
                options={[
                  { value: 'yes', label: t('common.yes') },
                  { value: 'no', label: t('common.no') },
                  { value: 'unknown', label: t('common.dontKnow') },
                ]}
              />
            </Field>
          </div>
          <p className="section-footer">{t('type.obsFooter')}</p>
        </div>
      )}

      <div className="sticky-cta">
        <button className="btn" disabled={!details.type} onClick={onNext}>
          {t('common.continue')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: 'drop' | 'warning'; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="subhead" style={{ fontWeight: 500 }}>
        {icon && <Icon name={icon} size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--label-2)' }} />}
        {label}
      </span>
      {children}
    </div>
  );
}
