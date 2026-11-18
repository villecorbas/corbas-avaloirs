import { useState } from 'react';
import { formatNumber, t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { MapView } from '../../components/MapView';
import { Bar, Spinner, Stars } from '../../components/ui';
import { accuracyLevel, distance, midpoint } from '../../lib/geo';
import { qualityParts, qualityScore, type PointLine } from '../../lib/gamification';
import { shortAddress, type Address } from '../../lib/geocode';
import { isOsmMappable, mergeIntoExisting, osmGeometry, osmTags, type DrainDetails, type Observations } from '../../lib/taxonomy';
import type { DrainRecord } from '../../lib/db';

export function ReviewStep({
  photoUrl,
  position,
  details,
  observations,
  sharpness,
  address,
  addressLoading,
  enrichTags,
  line,
  points,
  saving,
  onSave,
}: {
  photoUrl: string;
  position: DrainRecord['position'];
  details: DrainDetails;
  observations: Observations;
  sharpness: number;
  address?: Address;
  addressLoading: boolean;
  enrichTags?: Record<string, string>;
  line?: { a: { lat: number; lon: number }; b: { lat: number; lon: number } };
  points: { total: number; lines: PointLine[] };
  saving: boolean;
  onSave: () => void;
}) {
  const [showTags, setShowTags] = useState(false);
  const qInput = { acc: position.acc, samples: position.samples, sharpness, details, observations };
  const quality = qualityScore(qInput);
  const parts = qualityParts(qInput);
  const level = accuracyLevel(position.acc);
  const length = line ? distance(line.a, line.b) : undefined;
  const tags = enrichTags
    ? mergeIntoExisting(enrichTags, details, '‹photo›')
    : osmTags({ ...details, length }, '‹photo›');
  const geometry = isOsmMappable(details.type) ? (enrichTags ? null : osmGeometry(details.type)) : null;
  const center = line ? midpoint(line.a, line.b) : position;
  const tip = parts.find((p) => p.score < p.max && (p.key === 'details' || p.key === 'observations'));

  return (
    <div className="step-scroll">
      <h1 className="title1" style={{ margin: '4px 4px 14px' }}>{t('review.title')}</h1>

      <div className="review-hero">
        <img src={photoUrl} alt={t('photo.previewAlt')} />
        <div className="review-map">
          <MapView
            center={center}
            zoom={line ? 20 : 19}
            layer="ortho"
            interactive={false}
            markers={line ? [] : [{ id: 'p', lat: position.lat, lon: position.lon, kind: 'mine' }]}
            lines={line ? [{ id: 'l', points: [line.a, line.b], kind: 'mine' }] : undefined}
          />
        </div>
        <span className="chip review-type">{t(`types.${details.type}.name`)}</span>
      </div>

      <div className="list" style={{ marginTop: 14 }}>
        <div className="list-row">
          <Icon name="home" style={{ color: 'var(--label-2)' }} />
          <span>{t('review.address')}</span>
          <span className="value selectable" style={{ maxWidth: '60%' }}>
            {addressLoading ? <Spinner size={16} /> : shortAddress(address) || t('review.noAddress')}
          </span>
        </div>
        <div className="list-row">
          <Icon name="location" style={{ color: 'var(--label-2)' }} />
          <span>{t('review.precision')}</span>
          <span className="value">
            ± {formatNumber(position.acc, 1)} m · {t(`accuracy.${level}`)}
          </span>
        </div>
        {length !== undefined && (
          <div className="list-row">
            <Icon name="move" style={{ color: 'var(--label-2)' }} />
            <span>{t('review.length')}</span>
            <span className="value">≈ {formatNumber(length, 1)} m</span>
          </div>
        )}
        {(details.shape || details.material) && (
          <div className="list-row">
            <Icon name="grate" style={{ color: 'var(--label-2)' }} />
            <span>{t('review.details')}</span>
            <span className="value">
              {[details.shape && t(`shape.${details.shape}`), details.material && t(`material.${details.material}`)].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        {observations.standingWater && (
          <div className="list-row">
            <Icon name="drop" style={{ color: 'var(--blue)' }} />
            <span>{t('obs.standingWaterShort')}</span>
            <span className={`value water-value ${observations.standingWater}`}>{t(`water.short.${observations.standingWater}`)}</span>
          </div>
        )}
      </div>

      <h3 className="section-title">{t('review.quality')}</h3>
      <div className="card stack">
        <div className="row">
          <Stars value={quality.stars} size={22} />
          <span className="headline rounded-num" style={{ marginLeft: 'auto' }}>
            {quality.score}/100
          </span>
        </div>
        {parts.map((p) => (
          <div key={p.key} className="stack" style={{ gap: 5 }}>
            <div className="row footnote">
              <span>{t(`quality.${p.key}`)}</span>
              <span className="secondary" style={{ marginLeft: 'auto' }}>
                {p.score}/{p.max}
              </span>
            </div>
            <Bar progress={p.score / p.max} height={6} color={p.score / p.max > 0.7 ? 'var(--green)' : p.score / p.max > 0.4 ? 'var(--orange)' : 'var(--red)'} />
          </div>
        ))}
        {tip && (
          <p className="footnote secondary" style={{ margin: 0 }}>
            💡 {t(`quality.tip.${tip.key}`)}
          </p>
        )}
      </div>

      <h3 className="section-title">{t('review.publishing')}</h3>
      <div className="list">
        <button className="list-row" onClick={() => setShowTags(!showTags)} aria-expanded={showTags}>
          <span className="icon-tile" style={{ background: '#7ebc6f' }}>
            <Icon name="map" size={17} />
          </span>
          <span style={{ flex: 1 }}>
            OpenStreetMap
            <span className="footnote secondary" style={{ display: 'block' }}>
              {isOsmMappable(details.type)
                ? enrichTags
                  ? t('review.osmEnrich')
                  : geometry === 'way'
                    ? t('review.osmCreateLine')
                    : t('review.osmCreate')
                : t('review.osmSkip')}
            </span>
          </span>
          <Icon name="chevron" size={16} className="chev" style={{ transform: showTags ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }} />
        </button>
        {showTags && isOsmMappable(details.type) && (
          <pre className="tags-code selectable">
            {(geometry === 'way' ? `# ${t('review.geometryWay')}\n` : '') + Object.entries(tags).map(([k, v]) => `${k}=${v}`).join('\n')}
          </pre>
        )}
        <div className="list-row">
          <span className="icon-tile" style={{ background: '#c6a96b' }}>
            <Icon name="photo" size={17} />
          </span>
          <span style={{ flex: 1 }}>
            Panoramax
            <span className="footnote secondary" style={{ display: 'block' }}>{t('review.panoramax')}</span>
          </span>
        </div>
      </div>
      <p className="section-footer">{t('review.license')}</p>

      <div className="sticky-cta">
        <button className="btn" onClick={onSave} disabled={saving}>
          {saving ? <Spinner /> : <Icon name="check" stroke={2.6} />}
          {t('review.save', { points: points.total })}
        </button>
      </div>
    </div>
  );
}
