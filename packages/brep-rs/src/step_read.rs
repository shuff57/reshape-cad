//! Layer `step_read`: the STEP part-file tokenizer and entity graph (SPEC 3,
//! "STEP export and import"). Reading only -- `step.rs` writes, this parses,
//! and `step_in.rs` rebuilds topology from what this produces.

use std::collections::HashMap;

/// One attribute value in a STEP entity's parameter list.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Number(f64),
    Str(String),
    /// An enumeration with its dots stripped: `.MILLI.` parses to `Enum("MILLI")`.
    Enum(String),
    /// `#123`
    Ref(usize),
    List(Vec<Value>),
    /// `$`
    Unset,
    /// `*`
    Derived,
    /// A typed (select) parameter: an entity name applied to its own argument
    /// list in VALUE position, e.g. `LENGTH_MEASURE(1.E-07)` inside
    /// `UNCERTAINTY_MEASURE_WITH_UNIT(...)`. STEP uses these for measures, and
    /// dropping the type name would lose the only thing that says WHICH measure
    /// it is.
    Typed(String, Vec<Value>),
}

/// One instance. A SIMPLE instance has one name and one parameter list; a
/// COMPLEX instance (`#9 = ( A(..) B(..) C(..) );`) holds several components,
/// whose order VARIES between files -- always look a component up by name.
pub struct Entity {
    name: String,
    params: Vec<Value>,
    components: Vec<Entity>,
}

impl Entity {
    /// The type name of a simple entity, or the first component's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Positional attribute of a simple entity.
    pub fn param(&self, i: usize) -> Option<&Value> {
        self.params.get(i)
    }

    /// A named component of a complex entity, found by scanning, never by
    /// matching the whole line. Returns `self` for a simple entity of that name.
    pub fn component(&self, name: &str) -> Option<&Entity> {
        if !self.is_complex() {
            if self.name == name {
                return Some(self);
            }
            return None;
        }
        self.components.iter().find(|c| c.name == name)
    }

    /// True when this instance is a complex one.
    pub fn is_complex(&self) -> bool {
        !self.components.is_empty()
    }
}

pub struct Graph {
    entities: HashMap<usize, Entity>,
}

impl Graph {
    pub fn get(&self, id: usize) -> Option<&Entity> {
        self.entities.get(&id)
    }

    /// Every id whose entity is a simple instance of this type name.
    pub fn all(&self, name: &str) -> Vec<usize> {
        let mut ids: Vec<usize> = self
            .entities
            .iter()
            .filter(|(_, e)| !e.is_complex() && e.name == name)
            .map(|(id, _)| *id)
            .collect();
        ids.sort_unstable();
        ids
    }

    /// Every id whose entity has a component of this name (complex instances).
    pub fn all_with_component(&self, name: &str) -> Vec<usize> {
        let mut ids: Vec<usize> = self
            .entities
            .iter()
            .filter(|(_, e)| e.is_complex() && e.components.iter().any(|c| c.name == name))
            .map(|(id, _)| *id)
            .collect();
        ids.sort_unstable();
        ids
    }
}

/// Parse a whole STEP part file into its entity graph.
pub fn parse_step(text: &str) -> Result<Graph, String> {
    let toks = Lexer::new(text).tokenize()?;
    Parser {
        src: text,
        toks,
        pos: 0,
    }
    .parse()
}

/// A lexical token. `Other` carries any byte the grammar does not use, so the
/// lexer never fails on a stray character; the parser rejects it instead.
#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Hash(usize),
    Ident(String),
    Str(String),
    Number(f64),
    Enum(String),
    LParen,
    RParen,
    Comma,
    Dollar,
    Star,
    Equals,
    Semi,
    Other(char),
}

struct Token {
    kind: Tok,
    at: usize,
}

/// A byte offset turned into a plain, human-readable error.
fn err_at(src: &str, offset: usize, msg: &str) -> String {
    let offset = offset.min(src.len());
    let line = src[..offset].bytes().filter(|b| *b == b'\n').count() + 1;
    format!("line {line} (byte {offset}): {msg}")
}

struct Lexer<'a> {
    src: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a str) -> Lexer<'a> {
        Lexer {
            src,
            bytes: src.as_bytes(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn peek2(&self) -> Option<u8> {
        self.bytes.get(self.pos + 1).copied()
    }

    /// Tokenize the WHOLE file before any parsing. That is what makes a `;`
    /// inside a string (`'2;1'` in FILE_DESCRIPTION) safe: it is part of a
    /// `Str` token and never seen as a statement terminator.
    fn tokenize(mut self) -> Result<Vec<Token>, String> {
        let mut out = Vec::new();
        while let Some(c) = self.peek() {
            let at = self.pos;
            match c {
                b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                b'#' => {
                    self.pos += 1;
                    let start = self.pos;
                    while self.peek().map_or(false, |b| b.is_ascii_digit()) {
                        self.pos += 1;
                    }
                    if self.pos == start {
                        return Err(err_at(self.src, at, "expected digits after '#'"));
                    }
                    let n = self.src[start..self.pos]
                        .parse::<usize>()
                        .map_err(|_| err_at(self.src, at, "entity id out of range"))?;
                    out.push(Token {
                        kind: Tok::Hash(n),
                        at,
                    });
                }
                b'\'' => {
                    self.pos += 1;
                    let mut s = String::new();
                    loop {
                        match self.peek() {
                            None => return Err(err_at(self.src, at, "unterminated string")),
                            Some(b'\'') => {
                                self.pos += 1;
                                if self.peek() == Some(b'\'') {
                                    s.push('\'');
                                    self.pos += 1;
                                } else {
                                    break;
                                }
                            }
                            Some(_) => {
                                let ch = match self.src[self.pos..].chars().next() {
                                    Some(ch) => ch,
                                    None => {
                                        return Err(err_at(self.src, at, "unterminated string"))
                                    }
                                };
                                s.push(ch);
                                self.pos += ch.len_utf8();
                            }
                        }
                    }
                    out.push(Token {
                        kind: Tok::Str(s),
                        at,
                    });
                }
                b'.' => {
                    if self.peek2().map_or(false, |b| b.is_ascii_digit()) {
                        out.push(self.lex_number()?);
                    } else {
                        self.pos += 1;
                        let start = self.pos;
                        while let Some(b) = self.peek() {
                            if b == b'.' || !(b.is_ascii_alphanumeric() || b == b'_') {
                                break;
                            }
                            self.pos += 1;
                        }
                        if self.peek() != Some(b'.') {
                            return Err(err_at(self.src, at, "unterminated enumeration"));
                        }
                        let name = self.src[start..self.pos].to_string();
                        self.pos += 1;
                        if name.is_empty() {
                            return Err(err_at(self.src, at, "empty enumeration"));
                        }
                        out.push(Token {
                            kind: Tok::Enum(name),
                            at,
                        });
                    }
                }
                b'0'..=b'9' => out.push(self.lex_number()?),
                b'-' | b'+' => {
                    if self.peek2().map_or(false, |b| b.is_ascii_digit()) {
                        out.push(self.lex_number()?);
                    } else {
                        self.pos += 1;
                        out.push(Token {
                            kind: Tok::Other(c as char),
                            at,
                        });
                    }
                }
                b'(' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::LParen,
                        at,
                    });
                }
                b')' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::RParen,
                        at,
                    });
                }
                b',' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::Comma,
                        at,
                    });
                }
                b'$' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::Dollar,
                        at,
                    });
                }
                b'*' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::Star,
                        at,
                    });
                }
                b'=' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::Equals,
                        at,
                    });
                }
                b';' => {
                    self.pos += 1;
                    out.push(Token {
                        kind: Tok::Semi,
                        at,
                    });
                }
                _ if c.is_ascii_alphabetic() || c == b'_' => {
                    let start = self.pos;
                    while self
                        .peek()
                        .map_or(false, |b| b.is_ascii_alphanumeric() || b == b'_')
                    {
                        self.pos += 1;
                    }
                    out.push(Token {
                        kind: Tok::Ident(self.src[start..self.pos].to_string()),
                        at,
                    });
                }
                _ => {
                    let ch = match self.src[self.pos..].chars().next() {
                        Some(ch) => ch,
                        None => break,
                    };
                    self.pos += ch.len_utf8();
                    out.push(Token {
                        kind: Tok::Other(ch),
                        at,
                    });
                }
            }
        }
        Ok(out)
    }

    /// A number: optional sign, digits, optional `.` and digits, optional
    /// exponent. Rust's `f64::from_str` accepts every form in the corpus,
    /// including `1.E-07` (dot immediately before the E) and `-0.`.
    fn lex_number(&mut self) -> Result<Token, String> {
        let at = self.pos;
        if matches!(self.peek(), Some(b'-') | Some(b'+')) {
            self.pos += 1;
        }
        while self.peek().map_or(false, |b| b.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            while self.peek().map_or(false, |b| b.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'E') | Some(b'e')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'-') | Some(b'+')) {
                self.pos += 1;
            }
            while self.peek().map_or(false, |b| b.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let s = &self.src[at..self.pos];
        let n = s
            .parse::<f64>()
            .map_err(|_| err_at(self.src, at, &format!("bad number '{s}'")))?;
        Ok(Token {
            kind: Tok::Number(n),
            at,
        })
    }
}

/// The header keywords a part file may carry outside the DATA section. A
/// statement starting with anything else is not a STEP statement.
fn is_header_keyword(kw: &str) -> bool {
    matches!(
        kw,
        "ISO"
            | "HEADER"
            | "FILE_DESCRIPTION"
            | "FILE_NAME"
            | "FILE_SCHEMA"
            | "ENDSEC"
            | "DATA"
            | "END"
    )
}

struct Parser<'a> {
    src: &'a str,
    toks: Vec<Token>,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos).map(|t| &t.kind)
    }

    fn at(&self) -> usize {
        self.toks
            .get(self.pos)
            .map(|t| t.at)
            .unwrap_or(self.src.len())
    }

    fn bump(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).map(|t| t.kind.clone());
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), String> {
        if self.peek() == Some(want) {
            self.pos += 1;
            Ok(())
        } else {
            let found = match self.peek() {
                Some(t) => format!("{t:?}"),
                None => "end of input".to_string(),
            };
            Err(err_at(
                self.src,
                self.at(),
                &format!("expected {what}, found {found}"),
            ))
        }
    }

    fn parse(mut self) -> Result<Graph, String> {
        let mut entities = HashMap::new();
        while self.pos < self.toks.len() {
            match self.peek().cloned() {
                Some(Tok::Hash(_)) => {
                    let id = match self.bump() {
                        Some(Tok::Hash(n)) => n,
                        _ => return Err(err_at(self.src, self.at(), "expected entity id")),
                    };
                    self.expect(&Tok::Equals, "'='")?;
                    let ent = self.parse_instance()?;
                    self.expect(&Tok::Semi, "';'")?;
                    entities.insert(id, ent);
                }
                Some(Tok::Ident(kw)) => {
                    if !is_header_keyword(&kw) {
                        return Err(err_at(
                            self.src,
                            self.at(),
                            &format!("unexpected '{kw}' at top level"),
                        ));
                    }
                    self.skip_statement()?;
                }
                Some(t) => {
                    return Err(err_at(
                        self.src,
                        self.at(),
                        &format!("unexpected {t:?} at top level"),
                    ));
                }
                None => break,
            }
        }
        Ok(Graph { entities })
    }

    /// Consume a non-instance statement (HEADER, `ISO-10303-21;`, ...) up to
    /// and including its `;`.
    fn skip_statement(&mut self) -> Result<(), String> {
        while let Some(t) = self.bump() {
            if t == Tok::Semi {
                return Ok(());
            }
        }
        Err(err_at(
            self.src,
            self.src.len(),
            "statement not terminated by ';'",
        ))
    }

    fn parse_instance(&mut self) -> Result<Entity, String> {
        match self.peek().cloned() {
            Some(Tok::LParen) => self.parse_complex(),
            Some(Tok::Ident(_)) => {
                let name = match self.bump() {
                    Some(Tok::Ident(n)) => n,
                    _ => return Err(err_at(self.src, self.at(), "expected entity name")),
                };
                let params = self.parse_params()?;
                Ok(Entity {
                    name,
                    params,
                    components: Vec::new(),
                })
            }
            Some(t) => Err(err_at(
                self.src,
                self.at(),
                &format!("expected entity name or '(', found {t:?}"),
            )),
            None => Err(err_at(
                self.src,
                self.at(),
                "expected entity, found end of input",
            )),
        }
    }

    /// `( A(..) B(..) C(..) )`: components are space-separated, each with its
    /// own parameter list, and their order varies between files.
    fn parse_complex(&mut self) -> Result<Entity, String> {
        self.expect(&Tok::LParen, "'('")?;
        let mut components = Vec::new();
        loop {
            match self.peek().cloned() {
                Some(Tok::RParen) => {
                    self.pos += 1;
                    break;
                }
                Some(Tok::Ident(_)) => {
                    let name = match self.bump() {
                        Some(Tok::Ident(n)) => n,
                        _ => return Err(err_at(self.src, self.at(), "expected component name")),
                    };
                    let params = self.parse_params()?;
                    components.push(Entity {
                        name,
                        params,
                        components: Vec::new(),
                    });
                }
                Some(t) => {
                    return Err(err_at(
                        self.src,
                        self.at(),
                        &format!("expected component name or ')', found {t:?}"),
                    ));
                }
                None => {
                    return Err(err_at(
                        self.src,
                        self.at(),
                        "unterminated complex instance",
                    ));
                }
            }
        }
        let name = components.first().map(|c| c.name.clone()).unwrap_or_default();
        Ok(Entity {
            name,
            params: Vec::new(),
            components,
        })
    }

    fn parse_params(&mut self) -> Result<Vec<Value>, String> {
        self.expect(&Tok::LParen, "'('")?;
        let mut vals = Vec::new();
        if self.peek() == Some(&Tok::RParen) {
            self.pos += 1;
            return Ok(vals);
        }
        loop {
            vals.push(self.parse_value()?);
            match self.peek().cloned() {
                Some(Tok::Comma) => self.pos += 1,
                Some(Tok::RParen) => {
                    self.pos += 1;
                    break;
                }
                Some(t) => {
                    return Err(err_at(
                        self.src,
                        self.at(),
                        &format!("expected ',' or ')', found {t:?}"),
                    ));
                }
                None => {
                    return Err(err_at(
                        self.src,
                        self.at(),
                        "unterminated parameter list",
                    ));
                }
            }
        }
        Ok(vals)
    }

    fn parse_value(&mut self) -> Result<Value, String> {
        match self.peek().cloned() {
            Some(Tok::Number(n)) => {
                self.pos += 1;
                Ok(Value::Number(n))
            }
            Some(Tok::Str(_)) => match self.bump() {
                Some(Tok::Str(s)) => Ok(Value::Str(s)),
                _ => Err(err_at(self.src, self.at(), "expected string")),
            },
            Some(Tok::Enum(_)) => match self.bump() {
                Some(Tok::Enum(s)) => Ok(Value::Enum(s)),
                _ => Err(err_at(self.src, self.at(), "expected enumeration")),
            },
            Some(Tok::Hash(_)) => match self.bump() {
                Some(Tok::Hash(n)) => Ok(Value::Ref(n)),
                _ => Err(err_at(self.src, self.at(), "expected reference")),
            },
            Some(Tok::Dollar) => {
                self.pos += 1;
                Ok(Value::Unset)
            }
            Some(Tok::Star) => {
                self.pos += 1;
                Ok(Value::Derived)
            }
            Some(Tok::LParen) => Ok(Value::List(self.parse_params()?)),
            Some(Tok::Ident(_)) => {
                let name = match self.bump() {
                    Some(Tok::Ident(n)) => n,
                    _ => return Err(err_at(self.src, self.at(), "expected type name")),
                };
                let args = self.parse_params()?;
                Ok(Value::Typed(name, args))
            }
            Some(t) => Err(err_at(
                self.src,
                self.at(),
                &format!("expected a value, found {t:?}"),
            )),
            None => Err(err_at(
                self.src,
                self.at(),
                "expected a value, found end of input",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn num(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            other => panic!("expected Number, got {other:?}"),
        }
    }

    #[test]
    fn parses_entity_wrapped_mid_list() {
        let g = parse_step("#1 = CARTESIAN_POINT('',(0.,\n  0.,0.));").unwrap();
        let e = g.get(1).unwrap();
        assert_eq!(e.name(), "CARTESIAN_POINT");
        match e.param(1).unwrap() {
            Value::List(xs) => {
                assert_eq!(xs.len(), 3);
                assert_eq!(num(&xs[0]), 0.0);
                assert_eq!(num(&xs[2]), 0.0);
            }
            other => panic!("expected List, got {other:?}"),
        }
    }

    #[test]
    fn parses_entity_wrapped_between_name_and_paren() {
        let g = parse_step("#1 = CARTESIAN_POINT\n('',(1.,2.,3.));").unwrap();
        let e = g.get(1).unwrap();
        assert_eq!(e.name(), "CARTESIAN_POINT");
        assert_eq!(e.param(0).unwrap(), &Value::Str(String::new()));
    }

    #[test]
    fn parses_every_number_form() {
        let g = parse_step(
            "#1 = X(0.,-0.,1.,12.,-20.,8.0,6.28318530718,1.E-07,-2.939152317954E-15,-2.249639673993E-31,2000,3);",
        )
        .unwrap();
        let e = g.get(1).unwrap();
        assert_eq!(num(e.param(0).unwrap()), 0.0);
        let neg_zero = num(e.param(1).unwrap());
        assert_eq!(neg_zero, 0.0);
        assert!(neg_zero.is_sign_negative(), "-0. must keep its sign");
        assert_eq!(num(e.param(2).unwrap()), 1.0);
        assert_eq!(num(e.param(3).unwrap()), 12.0);
        assert_eq!(num(e.param(4).unwrap()), -20.0);
        assert_eq!(num(e.param(5).unwrap()), 8.0);
        assert_eq!(num(e.param(6).unwrap()), 6.28318530718);
        assert_eq!(num(e.param(7).unwrap()), 1.0e-7);
        assert_eq!(num(e.param(8).unwrap()), -2.939152317954e-15);
        assert_eq!(num(e.param(9).unwrap()), -2.249639673993e-31);
        assert_eq!(num(e.param(10).unwrap()), 2000.0);
        assert_eq!(num(e.param(11).unwrap()), 3.0);
    }

    #[test]
    fn string_keeps_structural_characters() {
        let g = parse_step("#1 = FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));")
            .unwrap();
        let e = g.get(1).unwrap();
        match e.param(0).unwrap() {
            Value::List(xs) => assert_eq!(
                xs[0],
                Value::Str("AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }".to_string())
            ),
            other => panic!("expected List, got {other:?}"),
        }
        let g = parse_step("#2 = X('a,b(c)#d{e}','Context #1');").unwrap();
        let e = g.get(2).unwrap();
        assert_eq!(e.param(0).unwrap(), &Value::Str("a,b(c)#d{e}".to_string()));
        assert_eq!(e.param(1).unwrap(), &Value::Str("Context #1".to_string()));
    }

    #[test]
    fn parses_empty_and_escaped_quotes() {
        let g = parse_step("#1 = X('','it''s');").unwrap();
        let e = g.get(1).unwrap();
        assert_eq!(e.param(0).unwrap(), &Value::Str(String::new()));
        assert_eq!(e.param(1).unwrap(), &Value::Str("it's".to_string()));
    }

    #[test]
    fn parses_enumerations_unset_and_derived() {
        let g = parse_step(
            "#1 = X(.T.,.F.,.MILLI.,.METRE.,.RADIAN.,.STERADIAN.,.PCURVE_S1.,.U.,.PIECEWISE_BEZIER_KNOTS.,.UNSPECIFIED.,$,*);",
        )
        .unwrap();
        let e = g.get(1).unwrap();
        for (i, name) in [
            "T",
            "F",
            "MILLI",
            "METRE",
            "RADIAN",
            "STERADIAN",
            "PCURVE_S1",
            "U",
            "PIECEWISE_BEZIER_KNOTS",
            "UNSPECIFIED",
        ]
        .iter()
        .enumerate()
        {
            assert_eq!(e.param(i).unwrap(), &Value::Enum(name.to_string()));
        }
        assert_eq!(e.param(10).unwrap(), &Value::Unset);
        assert_eq!(e.param(11).unwrap(), &Value::Derived);
    }

    #[test]
    fn complex_component_found_in_any_order() {
        let g = parse_step(
            "#346 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n\
             #347 = ( NAMED_UNIT(*) SI_UNIT($,.RADIAN.) PLANE_ANGLE_UNIT() );",
        )
        .unwrap();
        let a = g.get(346).unwrap();
        assert!(a.is_complex());
        let si = a.component("SI_UNIT").unwrap();
        assert_eq!(si.param(0).unwrap(), &Value::Enum("MILLI".to_string()));
        assert_eq!(si.param(1).unwrap(), &Value::Enum("METRE".to_string()));
        let b = g.get(347).unwrap();
        let si = b.component("SI_UNIT").unwrap();
        assert_eq!(si.param(0).unwrap(), &Value::Unset);
        assert_eq!(si.param(1).unwrap(), &Value::Enum("RADIAN".to_string()));
    }

    #[test]
    fn parses_nested_lists() {
        let g = parse_step("#1 = X((#346,#347,#348));").unwrap();
        let e = g.get(1).unwrap();
        assert_eq!(
            e.param(0).unwrap(),
            &Value::List(vec![Value::Ref(346), Value::Ref(347), Value::Ref(348)])
        );

        let g = parse_step("#2 = X(((#346,#347,#348)));").unwrap();
        let e = g.get(2).unwrap();
        match e.param(0).unwrap() {
            Value::List(outer) => {
                assert_eq!(outer.len(), 1);
                assert_eq!(
                    outer[0],
                    Value::List(vec![Value::Ref(346), Value::Ref(347), Value::Ref(348)])
                );
            }
            other => panic!("expected List, got {other:?}"),
        }
    }

    #[test]
    fn graph_all_and_all_with_component() {
        let g = parse_step(
            "#1 = CARTESIAN_POINT('',(0.,0.,0.));\n\
             #2 = CARTESIAN_POINT('',(1.,1.,1.));\n\
             #3 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );",
        )
        .unwrap();
        assert_eq!(g.all("CARTESIAN_POINT"), vec![1, 2]);
        assert_eq!(g.all_with_component("SI_UNIT"), vec![3]);
        assert_eq!(g.all("SI_UNIT"), Vec::<usize>::new());
    }

    #[test]
    fn parses_typed_select_parameter() {
        let g = parse_step(
            "#1 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#338,'a','b');",
        )
        .unwrap();
        let e = g.get(1).unwrap();
        assert_eq!(
            e.param(0).unwrap(),
            &Value::Typed("LENGTH_MEASURE".to_string(), vec![Value::Number(1.0e-7)])
        );
        assert_eq!(e.param(1).unwrap(), &Value::Ref(338));
    }

    #[test]
    fn parses_complex_instance_wrapped_between_name_and_paren() {
        let text = "#345 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) \nGLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#349)) GLOBAL_UNIT_ASSIGNED_CONTEXT\n((#346,#347,#348)) REPRESENTATION_CONTEXT('Context #1',\n  '3D Context with UNIT and UNCERTAINTY') );";
        let g = parse_step(text).unwrap();
        let e = g.get(345).unwrap();
        assert!(e.is_complex());
        assert_eq!(e.name(), "GEOMETRIC_REPRESENTATION_CONTEXT");
        let guac = e.component("GLOBAL_UNIT_ASSIGNED_CONTEXT").unwrap();
        assert_eq!(
            guac.param(0).unwrap(),
            &Value::List(vec![Value::Ref(346), Value::Ref(347), Value::Ref(348)])
        );
        let rep = e.component("REPRESENTATION_CONTEXT").unwrap();
        assert_eq!(rep.param(0).unwrap(), &Value::Str("Context #1".to_string()));
    }

    #[test]
    fn tolerates_header_and_semicolon_inside_strings() {
        let text = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Open CASCADE Model'),'2;1');\nFILE_NAME('x','2026',('A'),('B'),'c','d','e');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n#1 = CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n";
        let g = parse_step(text).unwrap();
        assert!(g.get(1).is_some());
        assert_eq!(g.all("CARTESIAN_POINT"), vec![1]);
    }

    #[test]
    fn garbage_returns_err_without_panicking() {
        for bad in [
            "this is not step at all !!!",
            "!!!",
            "#1 = ",
            "#1 = X(",
            "#1 = X(1.,",
            "#1 = X('unterminated",
            "#1 = X(.UNTERMINATED)",
            "#1 = X(1. 2.);",
            "#1 = X(1.,);",
            "#1 = X(1.)",
            "#",
            "#1 = X(1.);\n#2 = Y(2.)",
            "#1 = X(\u{00e9}\u{4e2d});",
        ] {
            assert!(parse_step(bad).is_err(), "expected Err for {bad:?}");
        }
        assert!(parse_step("#1 = X('caf\u{00e9}');").is_ok());
    }

    #[test]
    fn parses_every_occt_corpus_file() {
        let Ok(dir) = std::env::var("STEP_CORPUS") else {
            return;
        };
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
            .expect("STEP_CORPUS must be a readable directory")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map_or(false, |x| x == "step"))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no *.step files in {dir}");

        let mut closed_edges = 0usize;
        let mut seam_edges_twice_in_loop = 0usize;
        let mut vertex_loops = 0usize;
        let mut advanced_faces = 0usize;
        let mut axis2_2d = 0usize;

        for path in &files {
            let text = std::fs::read_to_string(path).expect("read corpus file");
            let g = parse_step(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));

            let mut found_len_unit = false;
            for id in g.all_with_component("SI_UNIT") {
                let si = g.get(id).unwrap().component("SI_UNIT").unwrap();
                if si.param(0) == Some(&Value::Enum("MILLI".to_string()))
                    && si.param(1) == Some(&Value::Enum("METRE".to_string()))
                {
                    found_len_unit = true;
                }
            }
            assert!(
                found_len_unit,
                "{}: no MILLI/METRE length unit",
                path.display()
            );

            for id in g.all("ADVANCED_FACE") {
                let e = g.get(id).unwrap();
                assert!(
                    matches!(e.param(1), Some(Value::List(_))),
                    "{}: ADVANCED_FACE #{id} bounds not a list",
                    path.display()
                );
                advanced_faces += 1;
            }
            for id in g.all("AXIS2_PLACEMENT_2D") {
                let e = g.get(id).unwrap();
                assert!(
                    matches!(e.param(1), Some(Value::Ref(_)))
                        && matches!(e.param(2), Some(Value::Ref(_)))
                        && e.param(3).is_none(),
                    "{}: AXIS2_PLACEMENT_2D #{id} is not a 2-attribute entity",
                    path.display()
                );
                axis2_2d += 1;
            }
            for id in g.all("EDGE_CURVE") {
                let e = g.get(id).unwrap();
                if let (Some(Value::Ref(a)), Some(Value::Ref(b))) = (e.param(1), e.param(2)) {
                    if a == b {
                        closed_edges += 1;
                    }
                }
            }
            for id in g.all("VERTEX_LOOP") {
                let _ = g.get(id).unwrap();
                vertex_loops += 1;
            }
            for id in g.all("EDGE_LOOP") {
                let e = g.get(id).unwrap();
                let Some(Value::List(refs)) = e.param(1) else {
                    continue;
                };
                let mut edges: Vec<usize> = Vec::new();
                for r in refs {
                    if let Value::Ref(oe) = r {
                        if let Some(Value::Ref(edge)) = g.get(*oe).and_then(|o| o.param(3)) {
                            edges.push(*edge);
                        }
                    }
                }
                for (i, edge) in edges.iter().enumerate() {
                    if edges[i + 1..].contains(edge) {
                        let is_seam = g
                            .get(*edge)
                            .and_then(|e| e.param(3))
                            .and_then(|v| match v {
                                Value::Ref(geom) => g.get(*geom),
                                _ => None,
                            })
                            .map_or(false, |geom| geom.name() == "SEAM_CURVE");
                        if is_seam {
                            seam_edges_twice_in_loop += 1;
                        }
                    }
                }
            }
        }

        println!("parsed {} corpus files", files.len());
        assert!(closed_edges > 0, "no closed EDGE_CURVE found");
        assert!(
            seam_edges_twice_in_loop > 0,
            "no SEAM_CURVE referenced twice in one EDGE_LOOP"
        );
        assert!(vertex_loops > 0, "no VERTEX_LOOP found");
        assert!(advanced_faces > 0, "no ADVANCED_FACE found");
        assert!(axis2_2d > 0, "no AXIS2_PLACEMENT_2D found");
    }
}
