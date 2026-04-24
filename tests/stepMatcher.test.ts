import {
  patternToRegex,
  matchStep,
  parseStepLine,
  filterDefinitions,
  StepDefinition,
} from '../server/src/stepMatcher';

// ── Helpers ───────────────────────────────────────────────────────────────────

const def = (pattern: string, decorator = 'given'): StepDefinition => ({
  pattern,
  file: 'steps.py',
  line: 1,
  decorator,
});

// ── patternToRegex ─────────────────────────────────────────────────────────────

describe('patternToRegex', () => {
  describe('literal patterns', () => {
    it('matches an exact literal string', () => {
      expect(patternToRegex('I click the button').test('I click the button')).toBe(true);
    });

    it('rejects a partial match (anchors applied)', () => {
      expect(patternToRegex('I click').test('I click the button')).toBe(false);
    });

    it('rejects a prefix-only match', () => {
      expect(patternToRegex('I click the button').test('I click the')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(patternToRegex('I click the button').test('I CLICK THE BUTTON')).toBe(true);
    });

    it('escapes . in literal text', () => {
      expect(patternToRegex('price is 5.00').test('price is 5X00')).toBe(false);
      expect(patternToRegex('price is 5.00').test('price is 5.00')).toBe(true);
    });

    it('escapes $ in literal text', () => {
      expect(patternToRegex('cost is $10').test('cost is $10')).toBe(true);
      expect(patternToRegex('cost is $10').test('cost is 10')).toBe(false);
    });

    it('escapes ( ) in literal text', () => {
      expect(patternToRegex('step (optional)').test('step (optional)')).toBe(true);
    });

    it('escapes [ ] in literal text', () => {
      expect(patternToRegex('option [a]').test('option [a]')).toBe(true);
      expect(patternToRegex('option [a]').test('option ba')).toBe(false);
    });

    it('escapes + in literal text', () => {
      expect(patternToRegex('1+1').test('1+1')).toBe(true);
      expect(patternToRegex('1+1').test('11')).toBe(false);
    });
  });

  describe('placeholders — no type', () => {
    it('{name} matches any non-empty text', () => {
      expect(patternToRegex('hello {name}').test('hello world')).toBe(true);
      expect(patternToRegex('hello {name}').test('hello Alice and Bob')).toBe(true);
    });

    it('{name} does not match empty', () => {
      expect(patternToRegex('hello {name}').test('hello ')).toBe(false);
    });
  });

  describe('placeholders — typed', () => {
    it(':d matches integers', () => {
      const re = patternToRegex('I have {n:d} items');
      expect(re.test('I have 0 items')).toBe(true);
      expect(re.test('I have 42 items')).toBe(true);
      expect(re.test('I have five items')).toBe(false);
      expect(re.test('I have 3.5 items')).toBe(false);
    });

    it(':f matches floats', () => {
      const re = patternToRegex('price is {amount:f}');
      expect(re.test('price is 3.14')).toBe(true);
      expect(re.test('price is -0.5')).toBe(true);
      expect(re.test('price is abc')).toBe(false);
    });

    it(':w matches a single word (no spaces)', () => {
      const re = patternToRegex('status is {s:w}');
      expect(re.test('status is active')).toBe(true);
      expect(re.test('status is two words')).toBe(false);
    });

    it(':s matches a non-whitespace token', () => {
      const re = patternToRegex('value is {v:s}');
      expect(re.test('value is abc123')).toBe(true);
      expect(re.test('value is two words')).toBe(false);
    });

    it(':S matches any string including spaces', () => {
      const re = patternToRegex('message is {m:S}');
      expect(re.test('message is hello world')).toBe(true);
    });

    it(':l matches letter-only strings (case-folded by the global i flag)', () => {
      const re = patternToRegex('role is {r:l}');
      expect(re.test('role is admin')).toBe(true);
      // The global `i` flag means [a-z]+ also matches uppercase — known limitation.
      expect(re.test('role is Admin')).toBe(true);
      expect(re.test('role is admin123')).toBe(false); // digits rejected by [a-z]+
    });

    it(':u matches letter-only strings (case-folded by the global i flag)', () => {
      const re = patternToRegex('code is {c:u}');
      expect(re.test('code is ABC')).toBe(true);
      // The global `i` flag means [A-Z]+ also matches lowercase — known limitation.
      expect(re.test('code is abc')).toBe(true);
      expect(re.test('code is abc123')).toBe(false); // digits rejected by [A-Z]+
    });

    it(':n matches numbers with thousands separators', () => {
      const re = patternToRegex('population is {p:n}');
      expect(re.test('population is 1,000,000')).toBe(true);
      expect(re.test('population is 42')).toBe(true);
    });

    it('unknown type code falls back to (.+)', () => {
      const re = patternToRegex('value is {v:unknown}');
      expect(re.test('value is anything at all')).toBe(true);
    });
  });

  describe('multiple placeholders', () => {
    it('handles two typed placeholders', () => {
      const re = patternToRegex('{name:w} has {count:d} items');
      expect(re.test('Alice has 5 items')).toBe(true);
      expect(re.test('Alice Bob has 5 items')).toBe(false);
    });
  });
});

// ── parseStepLine ─────────────────────────────────────────────────────────────

describe('parseStepLine', () => {
  it('returns null for a Feature line', () => {
    expect(parseStepLine('Feature: my feature')).toBeNull();
  });

  it('returns null for a Scenario line', () => {
    expect(parseStepLine('  Scenario: my scenario')).toBeNull();
  });

  it('returns null for a blank line', () => {
    expect(parseStepLine('')).toBeNull();
    expect(parseStepLine('   ')).toBeNull();
  });

  it('returns null for a comment line', () => {
    expect(parseStepLine('  # this is a comment')).toBeNull();
  });

  it('returns null for a tag line', () => {
    expect(parseStepLine('@smoke')).toBeNull();
  });

  it('parses a Given step with leading whitespace', () => {
    const result = parseStepLine('    Given I am logged in');
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe('Given');
    expect(result!.text).toBe('I am logged in');
    expect(result!.keywordStart).toBe(4);
    expect(result!.textStart).toBe(4 + 'Given '.length);
  });

  it('parses a When step at column 0', () => {
    const result = parseStepLine('When the button is clicked');
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe('When');
    expect(result!.text).toBe('the button is clicked');
    expect(result!.keywordStart).toBe(0);
    expect(result!.textStart).toBe('When '.length);
  });

  it('parses Then, And, But', () => {
    for (const kw of ['Then', 'And', 'But']) {
      const result = parseStepLine(`${kw} something happens`);
      expect(result).not.toBeNull();
      expect(result!.keyword).toBe(kw);
      expect(result!.text).toBe('something happens');
    }
  });

  it('is case-insensitive for keywords', () => {
    expect(parseStepLine('given I am here')).not.toBeNull();
    expect(parseStepLine('WHEN something')).not.toBeNull();
  });

  it('trims trailing whitespace from step text', () => {
    const result = parseStepLine('  Given some step   ');
    expect(result!.text).toBe('some step');
  });
});

// ── matchStep ─────────────────────────────────────────────────────────────────

describe('matchStep', () => {
  it('returns undefined for an empty definition list', () => {
    expect(matchStep('I click the button', [])).toBeUndefined();
  });

  it('returns undefined when no definition matches', () => {
    expect(matchStep('I click the button', [def('I hover over the button')])).toBeUndefined();
  });

  it('returns the matching definition', () => {
    const target = def('I click the button');
    const defs = [def('I hover'), target, def('I scroll')];
    expect(matchStep('I click the button', defs)).toBe(target);
  });

  it('returns the first match when multiple patterns match', () => {
    const first = def('I have {count:d} items');
    const second = def('I have {n} items');
    expect(matchStep('I have 5 items', [first, second])).toBe(first);
  });

  it('matches a parameterised pattern', () => {
    const target = def('the user {name} is logged in');
    expect(matchStep('the user Alice is logged in', [target])).toBe(target);
  });

  it('returns undefined when parameterised pattern does not match', () => {
    const target = def('I have {n:d} items');
    expect(matchStep('I have five items', [target])).toBeUndefined();
  });

  it('trims leading/trailing whitespace from step text before matching', () => {
    const target = def('I click the button');
    expect(matchStep('  I click the button  ', [target])).toBe(target);
  });

  it('is case-insensitive', () => {
    const target = def('I click the button');
    expect(matchStep('I CLICK THE BUTTON', [target])).toBe(target);
  });

  it('skips malformed patterns without throwing', () => {
    const bad = def('{unclosed');
    const good = def('I click the button');
    expect(() => matchStep('I click the button', [bad, good])).not.toThrow();
    expect(matchStep('I click the button', [bad, good])).toBe(good);
  });
});

// ── filterDefinitions ─────────────────────────────────────────────────────────

describe('filterDefinitions', () => {
  const defs: StepDefinition[] = [
    def('I click the button'),
    def('I hover over the button'),
    def('the form is submitted'),
    def('I enter my credentials'),
  ];

  it('returns all definitions for an empty query', () => {
    expect(filterDefinitions('', defs)).toHaveLength(4);
  });

  it('filters by case-insensitive substring', () => {
    const results = filterDefinitions('BUTTON', defs);
    expect(results).toHaveLength(2);
    expect(results[0].pattern).toBe('I click the button');
    expect(results[1].pattern).toBe('I hover over the button');
  });

  it('matches substring in the middle of a pattern', () => {
    expect(filterDefinitions('form', defs)).toHaveLength(1);
    expect(filterDefinitions('form', defs)[0].pattern).toBe('the form is submitted');
  });

  it('returns empty array when nothing matches', () => {
    expect(filterDefinitions('xyzzy', defs)).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    expect(filterDefinitions('', defs, 2)).toHaveLength(2);
  });

  it('uses default limit of 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => def(`step ${i}`));
    expect(filterDefinitions('step', many)).toHaveLength(50);
  });
});
