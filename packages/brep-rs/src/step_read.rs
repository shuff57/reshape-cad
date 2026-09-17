//! Layer `step_read`: the STEP part-file tokenizer and entity graph (SPEC 3,
//! "STEP export and import"). Reading only -- `step.rs` writes, this parses,
//! and `step_in.rs` rebuilds topology from what this produces.

// removed once implemented
#![allow(dead_code)]

use std::collections::HashMap;

/// One attribute value in a STEP entity's parameter list.
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
    let _ = text;
    Err("brep-rs STEP parser not built yet".to_string())
}