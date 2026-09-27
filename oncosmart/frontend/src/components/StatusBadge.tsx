import { useI18n } from '../i18n/I18nProvider';
import { Badge, Tone } from './ui';

type Kind = 'appointment' | 'order' | 'chair' | 'patient' | 'plan' | 'admin' | 'message';

const TONES: Record<Kind, Record<string, Tone>> = {
  appointment: {
    SCHEDULED: 'slate', CONFIRMED: 'teal', NEEDS_RESCHEDULING: 'orange', ARRIVED: 'amber', IN_PREPARATION: 'violet',
    IN_TREATMENT: 'blue', COMPLETED: 'green', CANCELLED: 'red', NO_SHOW: 'red',
  },
  order: {
    DRAFT: 'slate', PENDING_REVIEW: 'amber', APPROVED: 'teal', READY_FOR_PREPARATION: 'violet', PREPARED: 'violet',
    READY_FOR_ADMINISTRATION: 'sky', IN_PROGRESS: 'blue', COMPLETED: 'green', CANCELLED: 'red', HELD: 'orange', DELAYED: 'orange',
  },
  chair: { AVAILABLE: 'green', RESERVED: 'violet', PREPARING: 'amber', INFUSING: 'blue', CLEANING: 'sky', OUT_OF_SERVICE: 'red' },
  patient: {
    ACTIVE_TREATMENT: 'blue', TREATMENT_COMPLETED: 'green', ON_HOLD: 'orange', DISCONTINUED: 'slate', FOLLOW_UP: 'teal',
    PALLIATIVE_CARE: 'violet', DECEASED: 'slate',
  },
  plan: { ACTIVE: 'blue', COMPLETED: 'green', ON_HOLD: 'orange', DISCONTINUED: 'slate' },
  admin: { NOT_STARTED: 'slate', IN_PROGRESS: 'blue', PAUSED: 'amber', COMPLETED: 'green', STOPPED: 'red', NOT_GIVEN: 'slate' },
  message: { PENDING: 'slate', SENT: 'sky', DELIVERED: 'teal', READ: 'green', FAILED: 'red', CANCELLED: 'slate' },
};

export function statusTone(kind: Kind, status: string): Tone {
  return TONES[kind][status] ?? 'slate';
}

export function StatusBadge({ kind, status, className }: { kind: Kind; status: string | null | undefined; className?: string }) {
  const { t } = useI18n();
  if (!status) return <span className="text-slate-400">—</span>;
  return (
    <Badge tone={statusTone(kind, status)} dot className={className}>
      {t(`status.${kind}.${status}`, undefined, status)}
    </Badge>
  );
}
