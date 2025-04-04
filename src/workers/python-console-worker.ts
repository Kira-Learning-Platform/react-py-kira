import { PyodideWorker } from '../types/worker'
importScripts("https://assets.kira-learning.com/3rdParty/pyodide/pyodide/pyodide.js")

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

let pythonConsole: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reprShorten: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  awaitFut: (fut: unknown) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pyconsole: any
  clearConsole: () => void
}

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
    packages: string[][]
  ) {
    const decoder = new TextDecoder()
    self.pyodide = await self.loadPyodide({})
    self.pyodide.setStdout({
      write: (buffer: Uint8Array) => {
        stdout(decoder.decode(buffer))
        return buffer.byteLength
      },
      isatty: false,
    })

    await self.pyodide.loadPackage(['pyodide-http'])
    if (packages[0].length > 0) {
      await self.pyodide.loadPackage(packages[0])
    }
    if (packages[1].length > 0) {
      await self.pyodide.loadPackage(['micropip'])
      const micropip = self.pyodide.pyimport('micropip')
      await micropip.install(packages[1])
    }

    const id = self.crypto.randomUUID()
    const version = self.pyodide.version

    self.pyodide.registerJsModule('react_py', reactPyModule)

    const namespace = self.pyodide.globals.get('dict')()
    const initConsoleCode = `
import pyodide_http
pyodide_http.patch_all()

import sys
from pyodide.ffi import to_js
from pyodide.console import PyodideConsole, repr_shorten, BANNER
import __main__
BANNER = "Welcome to the Pyodide terminal emulator 🐍\\n" + BANNER
pyconsole = PyodideConsole(__main__.__dict__)
import builtins
async def await_fut(fut):
  res = await fut
  if res is not None:
    builtins._ = res
  return to_js([res], depth=1)
def clear_console():
  pyconsole.buffer = []
`
    await self.pyodide.runPythonAsync(initConsoleCode, { globals: namespace })
    const patchInputCode = `
import sys, builtins
import react_py
__prompt_str__ = ""
def get_input(prompt=""):
    global __prompt_str__
    __prompt_str__ = prompt
    print(prompt, end="")
    s = react_py.getInput("${id}", prompt)
    print()
    return s
builtins.input = get_input
sys.stdin.readline = lambda: react_py.getInput("${id}", __prompt_str__)
`
    await self.pyodide.runPythonAsync(patchInputCode, { globals: namespace })
    const reprShorten = namespace.get('repr_shorten')
    const banner = namespace.get('BANNER')
    const awaitFut = namespace.get('await_fut')
    const pyconsole = namespace.get('pyconsole')
    const clearConsole = namespace.get('clear_console')
    namespace.destroy()

    pythonConsole = {
      reprShorten,
      awaitFut,
      pyconsole,
      clearConsole
    }

    onLoad({ id, version, banner })
  },
  async run(
    code: string
  ): Promise<{ state: string; error?: string } | undefined> {
    if (!pythonConsole) {
      throw new Error('Console has not been initialised')
    }
    if (code === undefined) {
      throw new Error('No code to push')
    }
    let state
    for (const line of code.split('\n')) {
      const fut = pythonConsole.pyconsole.push(line)
      state = fut.syntax_check
      const wrapped = pythonConsole.awaitFut(fut)
      try {
        const [value] = await wrapped
        if (self.pyodide.isPyProxy(value)) {
          value.destroy()
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        if (error.constructor.name === 'PythonError') {
          const message = fut.formatted_error || error.message
          return { state, error: message.trimEnd() }
        } else {
          throw error
        }
      } finally {
        fut.destroy()
        wrapped.destroy()
      }
    }
    return { state }
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
