export async function restoreWebhookUrlDev(app, webhookUrlDev) {
  await app.setWebhookUrlDev(webhookUrlDev).update();
}
