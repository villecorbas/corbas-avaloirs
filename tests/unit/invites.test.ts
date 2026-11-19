import { beforeEach, describe, expect, it } from 'vitest';
import { computeProgress, recordPoints } from '../../src/lib/gamification';
import { INVITE_DAILY_CAP, INVITE_TOTAL_CAP, invitesToday, logInvite, readInvites, wasInvited } from '../../src/lib/inviteLog';

// localStorage minimal pour l'environnement Node des tests
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const T0 = new Date(2026, 10, 18, 10, 0).getTime();
const MIN = 60_000;

beforeEach(() => store.clear());

describe('Invitations : points', () => {
  it('+5 pts par invitation, plafonné à 3 par jour', () => {
    const r = [0, 1, 2, 3].map((i) => logInvite('whatsapp', T0 + i * MIN));
    expect(r.map((x) => x.counted)).toEqual([true, true, true, false]);
    expect(r[3].reason).toBe('daily');
    expect(invitesToday(readInvites(), T0 + 5 * MIN)).toBe(INVITE_DAILY_CAP);
    // le lendemain, le compteur repart
    expect(logInvite('sms', T0 + 24 * 60 * MIN).counted).toBe(true);
  });

  it('anti-rafale : deux clics en moins de 10 s = une seule invitation', () => {
    expect(logInvite('sms', T0).counted).toBe(true);
    const second = logInvite('email', T0 + 3000);
    expect(second.counted).toBe(false);
    expect(second.reason).toBe('burst');
    expect(readInvites().length).toBe(1);
  });

  it('plafond total de 20 invitations (100 pts)', () => {
    for (let day = 0; day < 12; day++) for (let i = 0; i < 3; i++) logInvite('sms', T0 + day * 24 * 60 * MIN + i * MIN);
    expect(readInvites().length).toBe(INVITE_TOTAL_CAP);
    expect(logInvite('sms', T0 + 30 * 24 * 60 * MIN).reason).toBe('total');
  });

  it('points, niveau et badges calculés avec les invitations', () => {
    for (let i = 0; i < 3; i++) logInvite('whatsapp', T0 + i * MIN);
    const p = computeProgress([], T0 + 10 * MIN);
    expect(p.invites).toBe(3);
    expect(p.invitePoints).toBe(15);
    expect(p.points).toBe(15);
    const recruiter = p.badges.find((b) => b.def.id === 'recruiter')!;
    expect(recruiter.unlockedAt).toBe(T0 + 2 * MIN);
    expect(p.badges.find((b) => b.def.id === 'ambassador')!.unlockedAt).toBeUndefined();
  });

  it('bonus de bienvenue pour la personne invitée, une seule fois', () => {
    const input = { acc: 5, samples: 4, sharpness: 0.5, details: { type: 'grate' as const }, observations: {}, mode: 'new' as const, at: T0 };
    expect(recordPoints(input, []).lines.map((l) => l.key)).not.toContain('invited');
    store.set('avaloirs.invitedBy', 'Camille');
    expect(wasInvited()).toBe(true);
    const first = recordPoints(input, []);
    expect(first.lines).toContainEqual({ key: 'invited', points: 10 });
    const later = recordPoints(input, [{ createdAt: T0 - 1000 } as never]);
    expect(later.lines.map((l) => l.key)).not.toContain('invited');
  });
});

import { invitePromptDue } from '../../src/lib/inviteLog';
describe('Rappel d’invitation par paliers', () => {
  it('2e avaloir : seulement si personne n’a été invité', () => {
    expect(invitePromptDue(2, 0, 0)).toBe(2);
    expect(invitePromptDue(2, 1, 0)).toBeNull();
  });
  it('un rappel par palier (5, 10, 20…), jamais deux fois', () => {
    expect(invitePromptDue(3, 0, 2)).toBeNull();
    expect(invitePromptDue(5, 0, 2)).toBe(5);
    expect(invitePromptDue(5, 3, 2)).toBe(5);
    expect(invitePromptDue(6, 0, 5)).toBeNull();
    expect(invitePromptDue(10, 0, 5)).toBe(10);
  });
  it('plus de rappel quand le plafond de points d’invitation est atteint', () => {
    expect(invitePromptDue(20, 20, 10)).toBeNull();
  });
  it('1er avaloir : rien', () => {
    expect(invitePromptDue(1, 0, 0)).toBeNull();
  });
});
