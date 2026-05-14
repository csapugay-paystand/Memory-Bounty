// A sample file that exercises every chunk type the chunker must handle

// 1. Plain function declaration
function greet(name: string): string {
  return `Hello, ${name}`;
}

// 2. Exported function declaration
export function farewell(name: string): string {
  return `Goodbye, ${name}`;
}

// 3. Arrow function const (non-exported)
const add = (a: number, b: number): number => a + b;

// 4. Exported arrow function const
export const multiply = (a: number, b: number): number => a * b;

// 5. Class with two methods
export class Calculator {
  private history: number[] = [];

  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(result);
    return result;
  }

  getHistory(): number[] {
    return this.history;
  }
}

// 6. Non-exported class
class Logger {
  log(message: string): void {
    console.log(`[LOG] ${message}`);
  }
}

// This should NOT be extracted (no symbol, just a top-level expression)
console.log("init");
