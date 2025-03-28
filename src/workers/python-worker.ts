import { PyodideWorker } from '../types/worker'

const CDN_URL = 'https://assets.kira-learning.com/3rdParty/pyodide/pyodide'

importScripts(`${CDN_URL}/pyodide.js`)

type Pyodide = PyodideWorker<micropip>

interface micropip {
  install: (packages: string[]) => Promise<void>
}

declare global {
  interface Window {
    loadPyodide: ({
      stdout
    }: {
      stdout?: (msg: string) => void
    }) => Promise<Pyodide>
    pyodide: Pyodide
    setReturnValue: (returnResult: ReturnResult | undefined) => void,
    outputLength: number
    returnResult: unknown
  }
}

// Monkey patch console.log to prevent the script from outputting logs
if (self.location.hostname !== 'localhost') {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  console.log = () => { }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  console.error = () => { }
}

import { expose } from 'comlink'
import { ReturnResult } from '../hooks/usePython'

const reactPyModule = {
  getInput: (id: string, prompt: string) => {
    const request = new XMLHttpRequest()
    // Synchronous request to be intercepted by service worker
    request.open('GET', `/react-py-get-input/?id=${id}&prompt=${encodeURIComponent(prompt)}`, false)
    request.send(null)
    return request.responseText
  }
}

const python = {
  async init(
    stdout: (msg: string) => void,
    onLoad: ({
      id,
      version,
      banner
    }: {
      id: string
      version: string
      banner?: string
    }) => void,
    setReturnValue: (returnResult: ReturnResult | undefined) => void,
    packages: string[][]
  ) {
    const decoder = new TextDecoder()
    self.setReturnValue = setReturnValue
    self.outputLength = 0
    self.returnResult = undefined
    self.pyodide = await self.loadPyodide({})

    self.pyodide.setStdout({
      isatty: false,
      write: (buf: Uint8Array) => {
        stdout?.(decoder.decode(buf))
        self.outputLength++
        return buf.byteLength
      }
    })
    await self.pyodide.loadPackage(['pyodide-http', `${CDN_URL}/zipp-3.20.2-py3-none-any.whl`, `${CDN_URL}/importlib_metadata-8.5.0-py3-none-any.whl`, `${CDN_URL}/importlib_resources-6.4.5-py3-none-any.whl`])
    if (packages[0].length > 0) {
      await self.pyodide.loadPackage(packages[0])
    }
    await self.pyodide.loadPackage(['micropip'])
    const micropip = self.pyodide.pyimport('micropip')
    await micropip.install(['matplotlib', 'beautifulsoup4', 'pandas', 'numpy', 'setuptools'])
    if (packages[1].length > 0) {
      await micropip.install(packages[1])
    }

    const id = self.crypto.randomUUID()
    const version = self.pyodide.version

    self.pyodide.registerJsModule('react_py', reactPyModule)
    const initCode = `
import pyodide_http
pyodide_http.patch_all()
`
    await self.pyodide.runPythonAsync(initCode)
    const patchInputCode = `
import sys, builtins
import react_py
__prompt_str__ = ""
def get_input(prompt=""):
    import os, sys
    global __prompt_str__
    __prompt_str__ = prompt
    print(prompt, end="", flush=True)
    sys.stdout.flush()
    os.fsync(sys.stdout)
    s = react_py.getInput("${id}", prompt)
    # print(s)
    return s
builtins.input = get_input
sys.stdin.readline = lambda: react_py.getInput("${id}", __prompt_str__)
`
    await self.pyodide.runPythonAsync(patchInputCode)

    onLoad({ id, version })
  },
  async run(code: string) {
    self.outputLength = 0
    self.setReturnValue(undefined)
    await self.pyodide
      .runPythonAsync(code)
      .then((output) => {
        self.setReturnValue({
          outputLength: self.outputLength,
          returnValue: output
        })
      })
      .catch((e) => {
        self.setReturnValue({
          outputLength: self.outputLength,
          returnValue: undefined
        })
        throw e
      })
  },
  readFile(name: string) {
    return self.pyodide.FS.readFile(name, { encoding: 'utf8' })
  },
  writeFile(name: string, data: string) {
    return self.pyodide.FS.writeFile(name, data, { encoding: 'utf8' })
  },
  mkdir(name: string) {
    self.pyodide.FS.mkdir(name)
  },
  rmdir(name: string) {
    self.pyodide.FS.rmdir(name)
  },
  unlink(name: string) {
    self.pyodide.FS.unlink(name)
  }
}

expose(python)
