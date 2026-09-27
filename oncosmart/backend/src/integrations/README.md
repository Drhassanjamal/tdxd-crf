# Integration points

| Area | Location | Status |
|------|----------|--------|
| WhatsApp Business API | `messaging/whatsappCloud.provider.ts` (+ webhook route `/api/integrations/whatsapp/webhook`) | Skeleton — enable with `MESSAGING_PROVIDER=whatsapp_cloud` |
| WhatsApp mock (default) | `messaging/mockWhatsApp.provider.ts` | Active — never sends messages |
| SMS / e-mail | implement `MessagingProvider` in `messaging/` and register in `messaging/index.ts` | Placeholder |
| Hospital EMR | `emr/emr.adapter.ts` | Placeholder |
| Laboratory (LIS) | `lis/laboratory.adapter.ts` | Placeholder |
| Pharmacy / inventory | `pharmacy/pharmacy.adapter.ts` | Placeholder (schema ready) |
| HL7 FHIR | `fhir/patient.mapper.ts` (+ `GET /api/integrations/fhir/Patient/:id`) | Read-only mapping demo |
| Clinical Assistant (AI) | `../services/clinicalAssistant/` | Rule-based placeholder, no AI model |
