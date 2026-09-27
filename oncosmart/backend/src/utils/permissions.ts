/**
 * Role-based access control matrix.
 *
 * Safety principle: NURSE and RECEPTION can never create, modify or approve
 * chemotherapy orders or doses. Only PHYSICIAN can prescribe/approve.
 */
export type Role = 'ADMIN' | 'PHYSICIAN' | 'NURSE' | 'RECEPTION';

export const PERMISSIONS = {
  // Patients
  'patients.read': ['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION'],
  'patients.create': ['ADMIN', 'PHYSICIAN', 'RECEPTION'],
  'patients.update': ['ADMIN', 'PHYSICIAN', 'RECEPTION'],
  'patients.status': ['ADMIN', 'PHYSICIAN'],
  'clinical.read': ['ADMIN', 'PHYSICIAN', 'NURSE'],
  'allergies.create': ['PHYSICIAN', 'NURSE', 'RECEPTION'],
  'allergies.inactivate': ['PHYSICIAN', 'NURSE'],
  'diagnoses.write': ['PHYSICIAN'],
  'plans.write': ['PHYSICIAN'],
  'labs.write': ['PHYSICIAN', 'NURSE'],
  'vitals.write': ['PHYSICIAN', 'NURSE'],
  'notes.write': ['PHYSICIAN', 'NURSE'],
  // Treatment orders — prescribing is physician-only
  'orders.read': ['ADMIN', 'PHYSICIAN', 'NURSE'],
  'orders.prescribe': ['PHYSICIAN'],
  'orders.approve': ['PHYSICIAN'],
  'orders.cancel': ['PHYSICIAN'],
  'orders.hold': ['PHYSICIAN', 'NURSE'],
  'orders.nursing': ['NURSE'],
  'events.report': ['PHYSICIAN', 'NURSE'],
  // Scheduling
  'appointments.read': ['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION'],
  'appointments.write': ['ADMIN', 'PHYSICIAN', 'RECEPTION', 'NURSE'], // nurses book the next visit at discharge
  'appointments.checkin': ['NURSE', 'RECEPTION'],
  'notifications.read': ['ADMIN', 'RECEPTION', 'PHYSICIAN', 'NURSE'],
  'notifications.send': ['ADMIN', 'RECEPTION'],
  'infusion.read': ['PHYSICIAN', 'NURSE', 'ADMIN'],
  // Configuration
  'protocols.read': ['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION'],
  'protocols.write': ['ADMIN'],
  'chairs.read': ['ADMIN', 'PHYSICIAN', 'NURSE', 'RECEPTION'],
  'chairs.manage': ['ADMIN'],
  'chairs.status': ['ADMIN', 'NURSE'],
  'reports.read': ['ADMIN', 'PHYSICIAN'],
  'users.manage': ['ADMIN'],
  'settings.manage': ['ADMIN'],
  'audit.read': ['ADMIN'],
  'assistant.use': ['PHYSICIAN', 'NURSE'],
  'integrations.fhir': ['ADMIN', 'PHYSICIAN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
