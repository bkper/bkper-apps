class AppEnvironment {
    isEmbedded(): boolean {
        return window.self !== window.top;
    }
}

export const appEnvironment = new AppEnvironment();
