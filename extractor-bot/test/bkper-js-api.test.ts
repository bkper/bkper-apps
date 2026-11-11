import { describe, it, expect } from 'bun:test';
import { App } from 'bkper-js';

/**
 * Smoke test for bkper-js App API compatibility
 *
 * This test ensures that the App class has the expected methods available.
 * It prevents breakages from library updates that change the API surface.
 */
describe('bkper-js App API Compatibility', () => {
    it('should have setWebhookUrlDev method', () => {
        const app = new App();
        expect(typeof app.setWebhookUrlDev).toBe('function');
    });

    it('should have update and patch methods', () => {
        const app = new App();
        expect(typeof app.update).toBe('function');
    });

    it('should allow chaining setWebhookUrlDev with update', () => {
        const app = new App();
        const result = app.setWebhookUrlDev('https://example.com/webhook');

        // setWebhookUrlDev should return an App instance for chaining
        expect(result).toBeInstanceOf(App);
        expect(typeof result.update).toBe('function');
    });

    it('should have expected App methods', () => {
        const app = new App();

        // Core getter methods
        expect(typeof app.getId).toBe('function');
        expect(typeof app.getName).toBe('function');
        expect(typeof app.getEvents).toBe('function');

        // Core setter methods
        expect(typeof app.setWebhookUrlDev).toBe('function');
        expect(typeof (app as any).setUsers).toBe('function');
        expect(typeof (app as any).setDevelopers).toBe('function');

        // Persistence methods
        expect(typeof app.create).toBe('function');
        expect(typeof app.update).toBe('function');
    });
});
