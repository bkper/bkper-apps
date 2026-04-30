import { BkperAuth } from '@bkper/web-auth';
import { Bkper, File as BkperFile } from 'bkper-js';

const isLocalDev =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const auth = new BkperAuth({
    baseUrl: isLocalDev ? window.location.origin : undefined,
    onLoginSuccess: () => loadFile(),
    onLoginRequired: () => showLogin(),
    onError: (error: Error) => showError(`Auth error: ${error.message}`),
});

auth.init();

function showLogin() {
    document.body.innerHTML = `
        <div style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:16px;">
            <p>Please sign in to view this file.</p>
            <button id="login-btn" style="padding:10px 20px;font-size:16px;cursor:pointer;">Sign in</button>
        </div>
    `;
    document.getElementById('login-btn')!.addEventListener('click', () => auth.login());
}

function showLoading(message = 'Loading...') {
    document.body.innerHTML = `
        <div style="display:flex;justify-content:center;align-items:center;height:100vh;">
            <p>${message}</p>
        </div>
    `;
}

function showError(message: string) {
    document.body.innerHTML = `
        <div style="display:flex;justify-content:center;align-items:center;height:100vh;padding:20px;text-align:center;color:#c00;">
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function loadFile() {
    const path = window.location.pathname;
    const match = path.match(/\/books\/([^/]+)\/files\/([^/]+)\/(.+)/);

    if (!match) {
        showError('Invalid URL. Expected: /books/{bookId}/files/{fileId}/{fileName}');
        return;
    }

    const [, bookId, fileId, rawFileName] = match;
    const fileName = decodeURIComponent(rawFileName);

    showLoading('Loading file...');

    try {
        const bkper = new Bkper({
            oauthTokenProvider: async () => auth.getAccessToken(),
        });

        const book = await bkper.getBook(bookId);
        const file = await book.getFile(fileId);

        if (!file) {
            showError('File not found.');
            return;
        }

        await renderFile(file, fileName);
    } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
    }
}

async function renderFile(file: BkperFile, fileName: string) {
    const contentType = file.getContentType() || 'application/octet-stream';

    const base64 = await file.getContent();
    if (!base64) {
        showError('File has no content.');
        return;
    }

    const blob = base64ToBlob(base64, contentType);
    const blobUrl = URL.createObjectURL(blob);

    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.height = '100vh';
    document.body.style.overflow = 'hidden';

    const preview = createPreviewElement(blobUrl, contentType);
    document.body.appendChild(preview);

    // Floating download button
    const downloadBtn = document.createElement('a');
    downloadBtn.href = blobUrl;
    downloadBtn.download = fileName;
    downloadBtn.textContent = 'Download';
    downloadBtn.style.position = 'fixed';
    downloadBtn.style.top = '12px';
    downloadBtn.style.right = '12px';
    downloadBtn.style.padding = '8px 16px';
    downloadBtn.style.background = '#ffffff';
    downloadBtn.style.border = '1px solid #cccccc';
    downloadBtn.style.borderRadius = '4px';
    downloadBtn.style.textDecoration = 'none';
    downloadBtn.style.color = '#333333';
    downloadBtn.style.fontFamily = 'system-ui, sans-serif';
    downloadBtn.style.fontSize = '14px';
    downloadBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    downloadBtn.style.zIndex = '9999';
    downloadBtn.style.cursor = 'pointer';
    document.body.appendChild(downloadBtn);
}

function createPreviewElement(blobUrl: string, contentType: string): HTMLElement {
    if (contentType.startsWith('image/')) {
        const wrapper = document.createElement('div');
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'center';
        wrapper.style.alignItems = 'center';
        wrapper.style.background = '#1a1a1a';

        const img = document.createElement('img');
        img.src = blobUrl;
        img.style.objectFit = 'contain';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        wrapper.appendChild(img);
        return wrapper;
    }

    if (contentType === 'application/pdf') {
        const embed = document.createElement('embed');
        embed.src = blobUrl;
        embed.type = 'application/pdf';
        embed.style.width = '100%';
        embed.style.height = '100%';
        embed.style.border = 'none';
        embed.style.display = 'block';
        return embed;
    }

    if (contentType.startsWith('text/') || contentType === 'application/json') {
        const iframe = document.createElement('iframe');
        iframe.src = blobUrl;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.display = 'block';
        return iframe;
    }

    // Fallback: iframe for anything else (browser may handle inline display)
    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    return iframe;
}

function base64ToBlob(base64: string, type: string): Blob {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type });
}
