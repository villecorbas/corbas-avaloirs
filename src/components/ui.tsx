import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { t } from '../i18n';

/* ----------------------------- Retour haptique -------------------------- */
export function haptic(kind: 'light' | 'success' | 'warning' = 'light') {
  try {
    const pattern = kind === 'success' ? [12, 60, 18] : kind === 'warning' ? [30, 40, 30] : 8;
    navigator.vibrate?.(pattern);
  } catch {
    /* non disponible (iOS) */
  }
}

/* ----------------------------- Anneau de progression -------------------- */
export function Ring({
  progress,
  size = 64,
  width = 8,
  color = 'var(--accent)',
  track = 'var(--fill)',
  children,
}: {
  progress: number;
  size?: number;
  width?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={width} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={width}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{ transition: 'stroke-dashoffset 0.8s var(--ease), stroke 0.4s' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  );
}

/* ----------------------------- Barre de progression --------------------- */
export function Bar({ progress, color = 'var(--accent)', height = 8 }: { progress: number; color?: string; height?: number }) {
  return (
    <div style={{ height, borderRadius: height, background: 'var(--fill)', overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
          background: color,
          borderRadius: height,
          transition: 'width 0.8s var(--ease)',
        }}
      />
    </div>
  );
}

/* ----------------------------- Feuille modale --------------------------- */
export function Sheet({
  open,
  onClose,
  children,
  title,
  elevated,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  elevated?: boolean;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className={`sheet ${elevated ? 'card-bg' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" />
        {title && (
          <div className="sheet-header">
            <h2 className="title3" style={{ flex: 1 }}>
              {title}
            </h2>
            <button className="icon-btn" style={{ width: 30, height: 30, boxShadow: 'none', background: 'var(--fill)' }} onClick={onClose} aria-label={t('common.close')}>
              <Icon name="close" size={16} stroke={2.4} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------- Toasts ----------------------------------- */
interface ToastItem {
  id: number;
  text: string;
  icon?: IconName;
  color?: string;
}
let toastId = 0;
const toastListeners = new Set<(t: ToastItem[]) => void>();
let toasts: ToastItem[] = [];

export function toast(text: string, icon?: IconName, color?: string) {
  const item = { id: ++toastId, text, icon, color };
  toasts = [...toasts, item];
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    toastListeners.forEach((l) => l(toasts));
  }, 3200);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => {
      toastListeners.delete(setItems);
    };
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.icon && <Icon name={t.icon} size={20} style={{ color: t.color || 'var(--accent)' }} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------- Contrôle segmenté ------------------------ */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => {
            haptic();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Compteur animé --------------------------- */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown}</>;
}

/* ----------------------------- Confettis -------------------------------- */
export function Confetti({ run }: { run: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!run || !ref.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#34c759', '#30b0c7', '#ffcc00', '#ff9500', '#af52de', '#007aff', '#ff2d55'];
    const w = canvas.offsetWidth;
    const parts = Array.from({ length: 110 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 60,
      y: canvas.offsetHeight * 0.32,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 10 - 4,
      r: Math.random() * 6 + 4,
      a: Math.random() * Math.PI,
      va: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    let frames = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.vy += 0.28;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.a += p.va;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      }
      if (++frames < 200) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true" />;
}

/* ----------------------------- Étoiles ---------------------------------- */
export function Stars({ value, size = 18 }: { value: number; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }} aria-label={`${value}/3`}>
      {[1, 2, 3].map((i) => (
        <Icon key={i} name="star" size={size} fill={i <= value} stroke={1.6} style={{ color: i <= value ? 'var(--yellow)' : 'var(--label-3)' }} />
      ))}
    </span>
  );
}

/* ----------------------------- Indicateur d'activité --------------------- */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
