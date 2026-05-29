var expect = require('chai').expect;

// Tests for helper namespace functions
describe('helper', () => {

    // Tests the getAccountQuery function which builds a query string for searching transactions
    // by account name with optional date filters
    describe('getAccountQuery(goodAccountName: string, beforeDate?: string, afterDate?: string): string', () => {

        const goodAccountName = 'Test Account';

        // Tests basic query with just account name
        it('should return the query string for the good account without beforeDate', () => {
            const query = helper.getAccountQuery(goodAccountName);

            expect(query).to.equal(`account:'${goodAccountName}'`);
        });

        // Tests query with account name and before date
        it('should return the query string for the good account with beforeDate', () => {
            const beforeDate = '2024-01-01';
            const query = helper.getAccountQuery(goodAccountName, beforeDate);

            expect(query).to.equal(`account:'${goodAccountName}' before:${beforeDate}`);
        });

        // Tests query with account name, before date and after date
        it('should return the query string for the good account with beforeDate and afterDate', () => {
            const beforeDate = '2024-01-31';
            const afterDate = '2024-01-01';
            const query = helper.getAccountQuery(goodAccountName, beforeDate, afterDate);

            expect(query).to.equal(`account:'${goodAccountName}' after:${afterDate} before:${beforeDate}`);
        });

    });

    // Tests the parseDate function which converts ISO date strings to Date objects
    describe('parseDate(ISOdate: string): Date', () => {

        it('should return the Date object for an ISO date string', () => {

            const isoDate = '2024-03-21';
            const date = helper.parseDate(isoDate);

            // Input: "2024-03-21"
            // Result: Date object representing March 21, 2024 at 13:00:00
            expect(date).to.deep.equal(new Date(2024, 2, 21, 13, 0, 0, 0));
        });

    });

});
