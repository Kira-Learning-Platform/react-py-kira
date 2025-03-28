export interface PyodideWorker<micropip> {
    loadPackage: (packages: string[]) => Promise<void>
    pyimport: (pkg: string) => micropip
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runPythonAsync: (code: string, namespace?: any) => Promise<void>
    version: string
    FS: {
        readFile: (name: string, options: unknown) => void
        writeFile: (name: string, data: string, options: unknown) => void
        mkdir: (name: string) => void
        rmdir: (name: string) => void
        unlink: (name: string) => void
    }
    setStdout: (options: {
        write: (buffer: Uint8Array) => number;
        isatty: boolean;
    }) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globals: any
    isPyProxy: (value: unknown) => boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerJsModule: any
}
