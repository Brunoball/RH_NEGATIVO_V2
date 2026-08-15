const fs = require('fs');
const path = require('path');

function cleanText(value) {
  return String(value || '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -\/]*[@-~])/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class RhCheckReporter {
  constructor(options = {}) {
    this.outputFolder = path.resolve(options.outputFolder || 'test-results-rh');
    this.outputFile = path.join(this.outputFolder, options.outputFile || 'resultado.txt');
    this.total = 0;
    this.finished = 0;
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.interrupted = 0;
    this.failures = [];
    this.startedAt = null;
    this.globalErrors = [];
    this.quiet = options.quiet === true;
  }

  printsToStdio() {
    return !this.quiet;
  }

  onBegin(_config, suite) {
    this.startedAt = new Date();
    this.total = suite.allTests().length;

    fs.rmSync(this.outputFolder, { recursive: true, force: true });
    fs.mkdirSync(this.outputFolder, { recursive: true });

    if (!this.quiet) process.stdout.write(`\nRH NEGATIVO · ${this.total} tests\n`);
  }

  onTestEnd(test, result) {
    // Solo contabilizamos el intento definitivo. Con retries=0 esto es siempre un único intento.
    this.finished += 1;

    if (result.status === 'passed') {
      this.passed += 1;
      if (!this.quiet) process.stdout.write('✓');
      return;
    }

    if (result.status === 'skipped') {
      this.skipped += 1;
      if (!this.quiet) process.stdout.write('○');
      return;
    }

    if (result.status === 'interrupted') {
      this.interrupted += 1;
      if (!this.quiet) process.stdout.write('!');
      this.failures.push({
        title: cleanText(test.titlePath().slice(1).join(' › ')),
        status: 'INTERRUMPIDO',
        error: cleanText(result.error?.message || result.errors?.[0]?.message || ''),
      });
      return;
    }

    this.failed += 1;
    if (!this.quiet) process.stdout.write('✗');
    this.failures.push({
      title: cleanText(test.titlePath().slice(1).join(' › ')),
      status: 'FALLÓ',
      error: cleanText(result.error?.message || result.errors?.[0]?.message || ''),
    });
  }

  onError(error) {
    this.globalErrors.push(cleanText(error?.message || error));
  }

  async onEnd(result) {
    const endedAt = new Date();
    const durationMs = this.startedAt ? endedAt.getTime() - this.startedAt.getTime() : 0;
    const durationSeconds = Math.max(0, Math.round(durationMs / 1000));
    const ok = result.status === 'passed' && this.failed === 0 && this.interrupted === 0 && this.globalErrors.length === 0;

    if (!this.quiet) {
      process.stdout.write('\n');
      process.stdout.write(
        `${ok ? '✓ TODO OK' : '✗ HAY FALLOS'} · ${this.passed}/${this.total} correctos` +
          `${this.failed ? ` · ${this.failed} fallidos` : ''}` +
          `${this.skipped ? ` · ${this.skipped} omitidos` : ''}` +
          `${this.interrupted ? ` · ${this.interrupted} interrumpidos` : ''}\n`,
      );
      process.stdout.write(`Resultado: test-results-rh\\resultado.txt\n\n`);
    }

    const lines = [
      'RH NEGATIVO V2 - RESULTADO TESTING',
      '=================================',
      `RESULTADO: ${ok ? '✓ TODO OK' : '✗ HAY FALLOS'}`,
      `TOTAL: ${this.total}`,
      `CORRECTOS: ${this.passed}`,
      `FALLIDOS: ${this.failed}`,
      `OMITIDOS: ${this.skipped}`,
      `INTERRUMPIDOS: ${this.interrupted}`,
      `DURACION_APROX_SEGUNDOS: ${durationSeconds}`,
      `FINALIZADO: ${endedAt.toISOString()}`,
    ];

    if (this.failures.length) {
      lines.push('', 'TESTS CON FALLO');
      lines.push('---------------');
      this.failures.forEach((failure, index) => {
        lines.push(`${index + 1}. ✗ ${failure.title || 'Test sin título'}`);
        if (failure.error) lines.push(`   ${failure.error}`);
      });
    }

    if (this.globalErrors.length) {
      lines.push('', 'ERRORES GLOBALES');
      lines.push('----------------');
      this.globalErrors.forEach((error, index) => {
        lines.push(`${index + 1}. ✗ ${error}`);
      });
    }

    lines.push('');
    fs.mkdirSync(this.outputFolder, { recursive: true });
    fs.writeFileSync(this.outputFile, `${lines.join('\r\n')}\r\n`, 'utf8');
  }
}

module.exports = RhCheckReporter;
