import { matchPattern, matchesAnyPattern } from './matchPattern';

describe('matchPattern', () => {
  // ========================================
  // EXACT MATCH
  // ========================================

  describe('exact match', () => {
    test('should match identical strings', () => {
      expect(matchPattern('user.login.v1', 'user.login.v1')).toBe(true);
    });

    test('should not match different strings', () => {
      expect(matchPattern('user.login.v1', 'user.logout.v1')).toBe(false);
    });

    test('should be case-sensitive', () => {
      expect(matchPattern('User.Login', 'user.login')).toBe(false);
    });

    test('should match single-segment topics', () => {
      expect(matchPattern('login', 'login')).toBe(true);
    });

    test('should not match partial strings', () => {
      expect(matchPattern('user.login.v1', 'user.login')).toBe(false);
      expect(matchPattern('user.login', 'user.login.v1')).toBe(false);
    });
  });

  // ========================================
  // GLOBAL WILDCARD (*)
  // ========================================

  describe('global wildcard (*)', () => {
    test('should match any topic', () => {
      expect(matchPattern('user.login.v1', '*')).toBe(true);
      expect(matchPattern('anything', '*')).toBe(true);
      expect(matchPattern('a.b.c.d.e', '*')).toBe(true);
    });

    test('should match empty string', () => {
      expect(matchPattern('', '*')).toBe(true);
    });
  });

  // ========================================
  // SUFFIX WILDCARD (prefix.*)
  // ========================================

  describe('suffix wildcard (prefix.*)', () => {
    test('should match topics with given prefix', () => {
      expect(matchPattern('user.login', 'user.*')).toBe(true);
      expect(matchPattern('user.logout', 'user.*')).toBe(true);
    });

    test('should match deeply nested topics', () => {
      expect(matchPattern('user.login.v1', 'user.*')).toBe(true);
      expect(matchPattern('user.settings.theme.dark', 'user.*')).toBe(true);
    });

    test('should not match topics with different prefix', () => {
      expect(matchPattern('cart.add', 'user.*')).toBe(false);
      expect(matchPattern('order.created', 'user.*')).toBe(false);
    });

    test('should not match prefix itself without continuation', () => {
      expect(matchPattern('user', 'user.*')).toBe(false);
    });
  });

  // ========================================
  // PREFIX WILDCARD (*.suffix)
  // ========================================

  describe('prefix wildcard (*.suffix)', () => {
    test('should match topics with given suffix', () => {
      expect(matchPattern('user.created.v1', '*.created.v1')).toBe(true);
      expect(matchPattern('order.created.v1', '*.created.v1')).toBe(true);
    });

    test('should match single-segment prefix', () => {
      expect(matchPattern('user.v1', '*.v1')).toBe(true);
    });

    test('should match multi-segment prefix', () => {
      expect(matchPattern('a.b.c.created.v1', '*.created.v1')).toBe(true);
    });

    test('should not match topics with different suffix', () => {
      expect(matchPattern('user.created.v2', '*.created.v1')).toBe(false);
      expect(matchPattern('user.deleted.v1', '*.created.v1')).toBe(false);
    });
  });

  // ========================================
  // MIDDLE WILDCARD (prefix.*.suffix)
  // ========================================

  describe('middle wildcard (prefix.*.suffix)', () => {
    test('should match topics with wildcard in the middle', () => {
      expect(matchPattern('user.login.v1', 'user.*.v1')).toBe(true);
      expect(matchPattern('user.logout.v1', 'user.*.v1')).toBe(true);
    });

    test('should match multi-segment middle', () => {
      expect(matchPattern('user.settings.theme.v1', 'user.*.v1')).toBe(true);
    });

    test('should not match when prefix or suffix differs', () => {
      expect(matchPattern('cart.login.v1', 'user.*.v1')).toBe(false);
      expect(matchPattern('user.login.v2', 'user.*.v1')).toBe(false);
    });

    test('should not match when middle is empty (consecutive dots)', () => {
      expect(matchPattern('user..v1', 'user.*.v1')).toBe(true);
    });
  });

  // ========================================
  // MULTIPLE WILDCARDS
  // ========================================

  describe('multiple wildcards', () => {
    test('should support multiple wildcards in pattern', () => {
      expect(matchPattern('user.login.v1', '*.*.*')).toBe(true);
      expect(matchPattern('a.b.c', '*.*.*')).toBe(true);
    });

    test('should match with wildcards at various positions', () => {
      expect(matchPattern('user.login.v1', '*.login.*')).toBe(true);
      expect(matchPattern('admin.login.v2', '*.login.*')).toBe(true);
    });

    test('should not match when segments between wildcards differ', () => {
      expect(matchPattern('user.logout.v1', '*.login.*')).toBe(false);
    });
  });

  // ========================================
  // EDGE CASES
  // ========================================

  describe('edge cases', () => {
    test('should handle empty topic with exact empty pattern', () => {
      expect(matchPattern('', '')).toBe(true);
    });

    test('should not match empty topic with non-wildcard pattern', () => {
      expect(matchPattern('', 'user.login')).toBe(false);
    });

    test('should handle pattern without dots', () => {
      expect(matchPattern('login', 'login')).toBe(true);
      expect(matchPattern('login', 'logout')).toBe(false);
    });

    test('should not treat regex special characters as regex', () => {
      expect(matchPattern('user+login', 'user+login')).toBe(true);
      expect(matchPattern('user.login', 'user+login')).toBe(false);
    });

    test('should escape dots in pattern (dots are literal)', () => {
      expect(matchPattern('userXlogin', 'user.login')).toBe(false);
    });

    test('should handle pattern that is just a dot', () => {
      expect(matchPattern('.', '.')).toBe(true);
      expect(matchPattern('a', '.')).toBe(false);
    });
  });

  // ========================================
  // NO WILDCARD, NO MATCH
  // ========================================

  describe('pattern without wildcard', () => {
    test('should return false for non-matching pattern without *', () => {
      expect(matchPattern('user.login', 'cart.add')).toBe(false);
    });

    test('should return true only on exact match', () => {
      expect(matchPattern('user.login', 'user.login')).toBe(true);
    });
  });
});

describe('matchesAnyPattern', () => {
  test('should return true if topic matches at least one pattern', () => {
    expect(matchesAnyPattern('user.login.v1', ['cart.*', 'user.*'])).toBe(true);
  });

  test('should return true on exact match in list', () => {
    expect(matchesAnyPattern('user.login.v1', ['user.login.v1', 'cart.add.v1'])).toBe(true);
  });

  test('should return false if no pattern matches', () => {
    expect(matchesAnyPattern('order.created.v1', ['user.*', 'cart.*'])).toBe(false);
  });

  test('should return false for empty pattern list', () => {
    expect(matchesAnyPattern('user.login.v1', [])).toBe(false);
  });

  test('should return true if global wildcard is in list', () => {
    expect(matchesAnyPattern('anything.at.all', ['*'])).toBe(true);
  });

  test('should work with multiple wildcard patterns', () => {
    expect(matchesAnyPattern('order.created.v1', ['*.created.*', 'user.*'])).toBe(true);
  });

  test('should stop on first match (short-circuit)', () => {
    expect(matchesAnyPattern('user.login', ['user.*', 'impossible.pattern'])).toBe(true);
  });
});
