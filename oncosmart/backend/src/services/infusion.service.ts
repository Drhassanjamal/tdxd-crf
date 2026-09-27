import { pool, q } from '../db/pool';
import { todayInTz } from '../utils/dates';
import { todaysAppointments } from './dashboard.service';
import { liveWarnings } from './orders.service';
import { getSettings } from './settings.service';

/** Today's infusion-room board: one card per appointment with order, warnings and administration progress. */
export async function infusionBoard(date?: string) {
  const s = await getSettings();
  const day = date ?? todayInTz(s.timezone);
  const appts = await todaysAppointments(day);
  const orderIds = appts.map((a) => a.treatment_order_id).filter(Boolean);
  const orders = orderIds.length ? await q(pool, 'SELECT * FROM treatment_orders WHERE id = ANY($1)', [orderIds]) : [];
  const items = orderIds.length ? await q(pool, 'SELECT * FROM treatment_order_items WHERE treatment_order_id = ANY($1) ORDER BY sequence', [orderIds]) : [];
  const admins = orderIds.length ? await q(pool, 'SELECT * FROM administrations WHERE treatment_order_id = ANY($1) ORDER BY sequence', [orderIds]) : [];
  const cards = [];
  for (const a of appts) {
    const order = orders.find((o) => o.id === a.treatment_order_id) ?? null;
    let warnings: any[] = [];
    if (order && !['COMPLETED', 'CANCELLED'].includes(order.status)) {
      warnings = await liveWarnings(pool, order, items.filter((i) => i.treatment_order_id === order.id), a);
    }
    cards.push({
      appointment: a,
      order: order
        ? {
            id: order.id,
            order_number: order.order_number,
            status: order.status,
            cycle_number: order.cycle_number,
            day_number: order.day_number,
            protocol_name: order.protocol_name,
            approved_at: order.approved_at,
            nurse_verified_at: order.nurse_verified_at,
            treatment_started_at: order.treatment_started_at,
            completed_at: order.completed_at,
          }
        : null,
      items: order ? items.filter((i) => i.treatment_order_id === order.id).map((i) => ({ id: i.id, drug_name: i.drug_name, final_dose: i.final_dose, route: i.route, infusion_duration_min: i.infusion_duration_min })) : [],
      administrations: order ? admins.filter((x) => x.treatment_order_id === order.id) : [],
      warnings: warnings.filter((w) => w.severity !== 'INFO'),
    });
  }
  const count = (...st: string[]) => appts.filter((a) => st.includes(a.status)).length;
  return {
    date: day,
    serverTime: new Date().toISOString(),
    summary: {
      total: appts.filter((a) => a.status !== 'CANCELLED').length,
      waiting: count('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'NEEDS_RESCHEDULING'),
      arrived: count('ARRIVED'),
      inPreparation: count('IN_PREPARATION'),
      inTreatment: count('IN_TREATMENT'),
      completed: count('COMPLETED'),
      cancelled: count('CANCELLED', 'NO_SHOW'),
    },
    cards,
  };
}
