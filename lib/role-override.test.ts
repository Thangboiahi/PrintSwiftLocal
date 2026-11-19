import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEffectiveRoleToProfile,
  resolveEffectiveRoleValue,
  sanitizeViewAsRoleCookie,
} from './role-override';
import { parseMapSettings } from './map-settings';

test('sanitizeViewAsRoleCookie normalizes valid roles and clears reset/actual', () => {
  assert.equal(sanitizeViewAsRoleCookie('owner'), 'owner');
  assert.equal(sanitizeViewAsRoleCookie('  STAFF '), 'staff');
  assert.equal(sanitizeViewAsRoleCookie('visitor'), 'visitor');
  assert.equal(sanitizeViewAsRoleCookie('actual'), null);
  assert.equal(sanitizeViewAsRoleCookie('reset'), null);
  assert.equal(sanitizeViewAsRoleCookie(''), null);
  assert.equal(sanitizeViewAsRoleCookie(null), null);
});

test('applyEffectiveRoleToProfile attaches actual_role, effective_role, and hierarchical role', () => {
  const superAdmin = applyEffectiveRoleToProfile(
    { id: 'u1', role: 'super_admin' },
    'visitor'
  );
  assert.equal(superAdmin?.actual_role, 'super_admin');
  assert.equal(superAdmin?.effective_role, 'visitor');
  assert.equal(superAdmin?.role, 'visitor');

  const ownerDowngrade = applyEffectiveRoleToProfile(
    { id: 'u2', role: 'owner' },
    'staff'
  );
  assert.equal(ownerDowngrade?.actual_role, 'owner');
  assert.equal(ownerDowngrade?.effective_role, 'staff');
  assert.equal(ownerDowngrade?.role, 'staff');

  const ownerBlockedEscalation = applyEffectiveRoleToProfile(
    { id: 'u2b', role: 'owner' },
    'super_admin'
  );
  assert.equal(ownerBlockedEscalation?.actual_role, 'owner');
  assert.equal(ownerBlockedEscalation?.effective_role, 'owner');
  assert.equal(ownerBlockedEscalation?.role, 'owner');

  const visitor = applyEffectiveRoleToProfile(
    { id: 'u3', role: 'visitor' },
    'super_admin'
  );
  assert.equal(visitor?.actual_role, 'visitor');
  assert.equal(visitor?.effective_role, 'visitor');
  assert.equal(visitor?.role, 'visitor');

  const noOverride = applyEffectiveRoleToProfile(
    { id: 'u4', role: 'super_admin' },
    null
  );
  assert.equal(noOverride?.actual_role, 'super_admin');
  assert.equal(noOverride?.effective_role, 'super_admin');
  assert.equal(noOverride?.role, 'super_admin');
});

test('resolveEffectiveRoleValue enforces hierarchical downgrades cleanly', () => {
  assert.equal(resolveEffectiveRoleValue('super_admin', 'owner'), 'owner');
  assert.equal(resolveEffectiveRoleValue('admin', 'staff'), 'staff');
  assert.equal(resolveEffectiveRoleValue('owner', 'visitor'), 'visitor');
  assert.equal(resolveEffectiveRoleValue('owner', 'super_admin'), 'owner');
  assert.equal(resolveEffectiveRoleValue('owner', 'admin'), 'owner');
  assert.equal(resolveEffectiveRoleValue('super_admin', 'actual'), 'super_admin');
  assert.equal(resolveEffectiveRoleValue('staff', 'super_admin'), 'staff');
});

test('parseMapSettings validates coordinates and clamps zoom', () => {
  const valid = parseMapSettings({ lat: 24.3335, lng: 93.6978, zoom: 14 });
  assert.deepEqual(valid, {
    lat: 24.3335,
    lng: 93.6978,
    zoom: 14,
    configured: true,
  });

  const clamped = parseMapSettings('{"lat": 24.1, "lng": 93.5, "zoom": 99}');
  assert.equal(clamped?.zoom, 20);

  assert.equal(parseMapSettings({ lat: 200, lng: 93.5 }), null);
  assert.equal(parseMapSettings(null), null);
});
