import { loadLocale } from 'report-shared/locale-loader';
import { reactive, Store } from './store';

/**
 * The language the interface is written in. Each language's strings are a chunk of their own,
 * so the interface shows in English at once and in the person's language as soon as its
 * strings arrive.
 */
export class Strings extends Store {
    /** The language of the texts on screen: English until those of `wanted` have loaded. */
    @reactive language = 'en';
    private loading?: Promise<void>;

    constructor(
        /** A Bkper language code. */
        readonly wanted: string,
        private readonly loader: (lang: string) => Promise<void> = loadLocale
    ) {
        super();
    }

    /** Loads the strings of `wanted` once; a failed load is tried again on the next call. */
    load(): Promise<void> {
        this.loading ??= this.loader(this.wanted).then(
            () => {
                this.language = this.wanted;
            },
            (error: unknown) => {
                this.loading = undefined;
                throw error;
            }
        );
        return this.loading;
    }
}
