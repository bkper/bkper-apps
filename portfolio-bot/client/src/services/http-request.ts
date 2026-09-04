export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type HttpQueryValue = string | number | boolean;

export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly statusText: string,
        readonly data: unknown
    ) {
        super(statusText);
        this.name = 'HttpError';
    }
}

export class HttpRequest<ResponseType = unknown> {
    private readonly params = new URLSearchParams();
    private readonly url: string;
    private readonly headers = new Headers();

    private method: HttpMethod = 'GET';
    private payload: unknown;
    private credentials: RequestCredentials = 'include';

    constructor(url: string) {
        this.url = url;
    }

    setMethod(method: HttpMethod): this {
        this.method = method;
        return this;
    }

    setHeader(name: string, value: string): this {
        this.headers.set(name, value);
        return this;
    }

    addParam(name: string, value: HttpQueryValue | null | undefined): this {
        if (value != null) {
            this.params.append(name, String(value));
        }
        return this;
    }

    setPayload(payload: unknown): this {
        this.payload = payload;
        return this;
    }

    disableCredentials(): this {
        this.credentials = 'omit';
        return this;
    }

    protected getMethod(): HttpMethod {
        return this.method;
    }

    async fetch(): Promise<ResponseType> {
        const headers = new Headers(this.headers);
        const body = this.payload === undefined ? undefined : JSON.stringify(this.payload);
        if (body !== undefined) {
            headers.set('content-type', 'application/json');
        }

        const response = await globalThis.fetch(this.getUrl(), {
            method: this.method,
            headers,
            body,
            credentials: this.credentials,
        });

        let data: unknown;
        try {
            data = await response.json();
        } catch (error: unknown) {
            if (response.ok) {
                throw error;
            }
        }

        if (!response.ok) {
            throw new HttpError(response.status, response.statusText, data);
        }
        return data as ResponseType;
    }

    private getUrl(): string {
        const query = this.params.toString();
        if (!query) {
            return this.url;
        }
        return `${this.url}${this.url.includes('?') ? '&' : '?'}${query}`;
    }
}
