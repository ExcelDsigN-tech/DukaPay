const runnerModule = require('jest-runner');
const TestRunner = runnerModule.default || runnerModule;

class SerialRunner extends TestRunner {
  constructor(globalConfig, context) {
    super(globalConfig, context);
    this.isSerial = true;
  }
}

module.exports = SerialRunner;
