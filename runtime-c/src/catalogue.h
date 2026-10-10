/*
 * What a loaded world says about its instances and its grammar (the spec's
 * The runtime > State; The compiler > What compiling produces): the kinds
 * with their properties and plays, the declared tree with each object's rank,
 * the verbs with their roles and phrases, the phrases a visitor may type in
 * the order they are tried, the intents, the messages, the caps the cartridge
 * was checked against and the extensions it pins. Bodies and prose stay as
 * graph nodes, with every name bound by index. Everything lives in the
 * world's load arena.
 */
#ifndef SPROUT_CATALOGUE_H
#define SPROUT_CATALOGUE_H

#include "graph.h"
#include "values.h"

/* A property's declared type: what a stored value is read under. */
typedef enum sprout_decl_kind {
  SPROUT_DECL_BOOLEAN,
  SPROUT_DECL_INTEGER,
  SPROUT_DECL_STRING,
  SPROUT_DECL_SYMBOL,
  SPROUT_DECL_LIST,
  SPROUT_DECL_EXTENSION
} sprout_decl_kind;

typedef struct sprout_decl_type {
  sprout_decl_kind kind;
  double min, max;                         /* an integer's range */
  const struct sprout_decl_type *element;  /* a list's element type */
  const char *key;                         /* the type key a stored value is written under */
  const char *enum_name;                   /* a symbol's enum, qualified */
  size_t option_count;
  const char **options;                    /* a symbol's options, in declared order */
} sprout_decl_type;

/* What a declared default is: a literal the declare tier has checked against the type. */
typedef enum sprout_literal_kind {
  SPROUT_LITERAL_BOOLEAN,
  SPROUT_LITERAL_NUMBER,
  SPROUT_LITERAL_STRING,
  SPROUT_LITERAL_OPTION,
  SPROUT_LITERAL_LIST
} sprout_literal_kind;

typedef struct sprout_literal {
  sprout_literal_kind kind;
  bool boolean;
  double number;
  const char *text; /* a string, or an option's name */
  size_t count;
  struct sprout_literal *items;
} sprout_literal;

typedef struct sprout_property {
  const char *name;
  const sprout_decl_type *type;
  bool remembered; /* held per actor rather than per object */
  const char *origin;
  sprout_literal default_value;
} sprout_property;

/* One kind's play of a verb's role, as a body that plays it reads it. */
typedef struct sprout_play {
  const char *origin, *library, *verb, *role;
  bool any;
  const sprout_node *node; /* the play: its guard, its narrowings and its body */
} sprout_play;

/* The plays under one key, "as actor for sprout.take", in the order they run. */
typedef struct sprout_play_group {
  const char *key;
  size_t count;
  sprout_play *plays;
} sprout_play_group;

typedef struct sprout_passage {
  const char *name;
  const sprout_node *node;
} sprout_passage;

typedef struct sprout_kind_def {
  const char *library, *name;
  const char *qualified; /* library.name */
  size_t order_count;
  const char **order; /* every kind it composes, itself last */
  size_t property_count;
  sprout_property *properties; /* in declared order */
  size_t passage_count;
  sprout_passage *passages;
  size_t play_group_count;
  sprout_play_group *plays;
  bool contains, contains_actors;
  bool composes_world, composes_visitor;
  bool spawnable; /* a spawn may name it: not the world's, not a visitor's */
  const sprout_node *node; /* guards, handlers, hooks, passes, grammar and exits stay here */
} sprout_kind_def;

/* One object a kind's body gives every instance. */
typedef struct sprout_content {
  const char *giver; /* the qualified kind whose body writes it */
  size_t path_count;
  const char **path;
  const sprout_kind_def *kind; /* NULL where the kind is absent */
  size_t held_count;
  struct sprout_content *held;
} sprout_content;

typedef struct sprout_content_list {
  const char *kind; /* the qualified kind whose body this is */
  size_t count;
  sprout_content *items;
} sprout_content_list;

/* One object the declared tree places. */
typedef struct sprout_declared {
  const char *id;        /* world.a.b */
  const char *container; /* the id of its declared container */
  size_t path_count;
  const char **path;
  const sprout_kind_def *kind; /* NULL where the kind is absent */
  size_t rank;                 /* its position in one walk of the tree, outside in */
} sprout_declared;

typedef enum sprout_filler_kind {
  SPROUT_FILLER_NONE,
  SPROUT_FILLER_KIND,
  SPROUT_FILLER_OPEN,
  SPROUT_FILLER_SYMBOL,
  SPROUT_FILLER_INTEGER,
  SPROUT_FILLER_EXIT
} sprout_filler_kind;

typedef struct sprout_role {
  const char *name;
  sprout_filler_kind filler;
  const sprout_kind_def *filler_kind;
  bool many, optional, carried;
} sprout_role;

/* A run of words, or a slot by the index of the role it fills. */
typedef struct sprout_part {
  bool is_slot;
  size_t role;
  const char *text;
} sprout_part;

typedef struct sprout_phrase {
  const char *text;
  size_t part_count;
  sprout_part *parts;
} sprout_phrase;

typedef struct sprout_verb {
  const char *library, *name;
  size_t role_count;
  sprout_role *roles;
  size_t phrase_count;
  sprout_phrase *phrases;
  const sprout_node *node;
} sprout_verb;

/* A world's or an object's synonym for a verb, as the phrases it gives. */
typedef struct sprout_synonym {
  const sprout_verb *verb;
  size_t phrase_count;
  sprout_phrase *phrases;
  const char *object; /* the id of the object it holds for, or NULL for the world's */
} sprout_synonym;

/* A part of a typed phrase: words (lower case, a comma a word of its own), or a slot by role. */
typedef struct sprout_typed_part {
  bool is_slot;
  size_t role;
  size_t word_count;
  const char **words;
} sprout_typed_part;

/* One phrase a visitor may type, ready to try against a typed line. */
typedef struct sprout_typed_phrase {
  const sprout_verb *verb;
  size_t part_count;
  sprout_typed_part *parts;
  const char *only; /* the object an object's synonym holds for, or NULL */
} sprout_typed_phrase;

typedef struct sprout_intent_step {
  const sprout_verb *verb;
  size_t filler_count;
  const char **filler_roles; /* each role the step gives... */
  size_t *filler_slots;      /* ...and the slot that fills it */
  const sprout_node *when;   /* the condition read before the step runs, or a null node */
} sprout_intent_step;

typedef struct sprout_intent {
  const char *library, *name;
  size_t slot_count;
  const char **slots;
  size_t phrase_count;
  sprout_phrase *phrases;
  size_t step_count;
  sprout_intent_step *steps;
} sprout_intent;

typedef struct sprout_typed_intent_phrase {
  const sprout_intent *intent;
  size_t part_count;
  sprout_typed_part *parts;
} sprout_typed_intent_phrase;

typedef struct sprout_message {
  const char *library, *name;
  const sprout_decl_type *carries; /* NULL where it carries nothing */
} sprout_message;

/* The static caps a cartridge records: what the world was checked against at publish. */
typedef struct sprout_caps {
  double options_per_enum, roles_per_verb, phrases_per_verb, steps_per_intent, phrase_characters,
      nouns_per_object, noun_characters, exits_per_place, list_elements, literal_characters;
  bool places_set, objects_set, kinds_set, files_set, source_bytes_set;
  double places, objects, kinds, files, source_bytes;
} sprout_caps;

typedef struct sprout_library {
  const char *name, *version, *sha;
} sprout_library;

typedef struct sprout_extension_pin {
  const char *name;
  long major;
} sprout_extension_pin;

typedef struct sprout_cartridge_header {
  const char *name, *namespace_name, *version, *author, *license, *hash;
  long level;
  size_t file_count;
  const char **files;
  size_t library_count;
  sprout_library *libraries;
} sprout_cartridge_header;

#endif
