class SourceAdapter {
  constructor(name) {
    this.name = name;
  }

  async search(_query, _scope) {
    throw new Error(`adapter_not_implemented:${this.name}`);
  }
}

class OemSourceAdapter extends SourceAdapter {
  constructor() {
    super('oem');
  }
}

class MitchellStyleAdapter extends SourceAdapter {
  constructor() {
    super('mitchell_style');
  }
}

class AccountingSourceAdapter extends SourceAdapter {
  constructor() {
    super('accounting');
  }
}

class LegalSourceAdapter extends SourceAdapter {
  constructor() {
    super('legal');
  }
}

class BusinessSourceAdapter extends SourceAdapter {
  constructor() {
    super('business');
  }
}

function createFutureAdapters() {
  return {
    oem: new OemSourceAdapter(),
    mitchellStyle: new MitchellStyleAdapter(),
    accounting: new AccountingSourceAdapter(),
    legal: new LegalSourceAdapter(),
    business: new BusinessSourceAdapter()
  };
}

module.exports = {
  SourceAdapter,
  OemSourceAdapter,
  MitchellStyleAdapter,
  AccountingSourceAdapter,
  LegalSourceAdapter,
  BusinessSourceAdapter,
  createFutureAdapters
};
