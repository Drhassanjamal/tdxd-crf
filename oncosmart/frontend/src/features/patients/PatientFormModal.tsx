import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Select } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { usePhysicians } from '../../hooks/useSettings';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';

export const GOVERNORATES = [
  'Baghdad', 'Basra', 'Nineveh', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk', 'Anbar', 'Babil', 'Karbala', 'Najaf',
  'Diyala', 'Wasit', 'Maysan', 'Dhi Qar', 'Muthanna', 'Qadisiyyah', 'Saladin', 'Halabja',
];

const empty = {
  mrn: '', firstName: '', lastName: '', fullNameAr: '', dateOfBirth: '', sex: 'MALE', phone: '', governorate: 'Baghdad', address: '',
  preferredLanguage: 'ar', emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '', primaryOncologistId: '',
  noKnownAllergies: false, heightCm: '', weightKg: '',
};

export function PatientFormModal({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: any; onSaved?: (p: any) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const physicians = usePhysicians();
  const [f, setF] = useState<any>(empty);
  const [allergies, setAllergies] = useState<{ allergen: string; reaction: string; severity: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    if (patient) {
      setF({
        mrn: patient.mrn, firstName: patient.first_name, lastName: patient.last_name, fullNameAr: patient.full_name_ar ?? '',
        dateOfBirth: patient.date_of_birth, sex: patient.sex, phone: patient.phone ?? '', governorate: patient.governorate ?? '',
        address: patient.address ?? '', preferredLanguage: patient.preferred_language, emergencyContactName: patient.emergency_contact_name ?? '',
        emergencyContactPhone: patient.emergency_contact_phone ?? '', emergencyContactRelation: patient.emergency_contact_relation ?? '',
        primaryOncologistId: patient.primary_oncologist_id ?? '', noKnownAllergies: patient.no_known_allergies,
        heightCm: patient.height_cm ?? '', weightKg: patient.weight_kg ?? '',
      });
    } else {
      setF(empty);
      setAllergies([]);
    }
  }, [open, patient]);
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const m = useMutation({
    mutationFn: () => {
      const body: any = {
        ...f,
        fullNameAr: f.fullNameAr || null,
        phone: f.phone || null,
        address: f.address || null,
        emergencyContactName: f.emergencyContactName || null,
        emergencyContactPhone: f.emergencyContactPhone || null,
        emergencyContactRelation: f.emergencyContactRelation || null,
        primaryOncologistId: f.primaryOncologistId || null,
        heightCm: f.heightCm === '' ? null : Number(f.heightCm),
        weightKg: f.weightKg === '' ? null : Number(f.weightKg),
      };
      if (patient) return api.patch(`/patients/${patient.id}`, body);
      return api.post('/patients', { ...body, allergies: allergies.filter((a) => a.allergen.trim()).map((a) => ({ ...a, reaction: a.reaction || null })) });
    },
    onSuccess: (p) => {
      toast.success(patient ? t('common.success') : t('patients.created'));
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      onSaved?.(p);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={patient ? t('common.edit') : t('patients.register')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('patients.mrn')} required>
            <Input value={f.mrn} onChange={set('mrn')} placeholder="DEMO-001" className="ltr-nums" />
          </Field>
          <Field label={t('patients.firstName')} required>
            <Input value={f.firstName} onChange={set('firstName')} />
          </Field>
          <Field label={t('patients.lastName')} required>
            <Input value={f.lastName} onChange={set('lastName')} />
          </Field>
          <Field label={t('patients.nameAr')}>
            <Input value={f.fullNameAr} onChange={set('fullNameAr')} dir="rtl" />
          </Field>
          <Field label={t('patients.dob')} required>
            <Input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
          <Field label={t('patients.sex')} required>
            <Select value={f.sex} onChange={set('sex')}>
              <option value="MALE">{t('patients.MALE')}</option>
              <option value="FEMALE">{t('patients.FEMALE')}</option>
            </Select>
          </Field>
          <Field label={t('patients.phone')} hint="+964 7XX XXX XXXX">
            <Input value={f.phone} onChange={set('phone')} className="ltr-nums" inputMode="tel" />
          </Field>
          <Field label={t('patients.governorate')}>
            <Select value={f.governorate} onChange={set('governorate')}>
              {GOVERNORATES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('patients.preferredLanguage')}>
            <Select value={f.preferredLanguage} onChange={set('preferredLanguage')}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={t('patients.address')} className="sm:col-span-3">
            <Input value={f.address} onChange={set('address')} />
          </Field>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">{t('patients.emergencyContact')}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('patients.emergencyName')}>
              <Input value={f.emergencyContactName} onChange={set('emergencyContactName')} />
            </Field>
            <Field label={t('patients.emergencyPhone')}>
              <Input value={f.emergencyContactPhone} onChange={set('emergencyContactPhone')} className="ltr-nums" />
            </Field>
            <Field label={t('patients.emergencyRelation')}>
              <Input value={f.emergencyContactRelation} onChange={set('emergencyContactRelation')} />
            </Field>
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('patients.oncologist')}>
            <Select value={f.primaryOncologistId} onChange={set('primaryOncologistId')}>
              <option value="">—</option>
              {physicians.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${t('patients.height')} (cm)`}>
            <Input type="number" value={f.heightCm} onChange={set('heightCm')} min={30} max={260} step="0.1" />
          </Field>
          <Field label={`${t('patients.weight')} (kg)`}>
            <Input type="number" value={f.weightKg} onChange={set('weightKg')} min={1} max={400} step="0.1" />
          </Field>
        </div>
        {!patient && (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-600">{t('patients.allergies')}</legend>
            <Checkbox
              checked={f.noKnownAllergies}
              onChange={(v) => {
                setF((x: any) => ({ ...x, noKnownAllergies: v }));
                if (v) setAllergies([]);
              }}
              label={t('patients.noKnownAllergies')}
            />
            {!f.noKnownAllergies && (
              <div className="mt-2 space-y-2">
                {allergies.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] gap-2">
                    <Input placeholder={t('patients.allergen')} value={a.allergen} onChange={(e) => setAllergies((x) => x.map((y, j) => (j === i ? { ...y, allergen: e.target.value } : y)))} />
                    <Input placeholder={t('patients.reaction')} value={a.reaction} onChange={(e) => setAllergies((x) => x.map((y, j) => (j === i ? { ...y, reaction: e.target.value } : y)))} />
                    <Select value={a.severity} onChange={(e) => setAllergies((x) => x.map((y, j) => (j === i ? { ...y, severity: e.target.value } : y)))}>
                      {['UNKNOWN', 'MILD', 'MODERATE', 'SEVERE'].map((s) => (
                        <option key={s} value={s}>
                          {t(`events.${s}`)}
                        </option>
                      ))}
                    </Select>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAllergies((x) => x.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAllergies((x) => [...x, { allergen: '', reaction: '', severity: 'UNKNOWN' }])}>
                  {t('patients.addAllergy')}
                </Button>
              </div>
            )}
          </fieldset>
        )}
        <ErrorBox error={m.error} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
