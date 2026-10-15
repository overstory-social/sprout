/* The fake's system: the allocator, the clock, the console, the input, the system menu and the frame, and the fake made whole; see fake_playdate.h. */
#include "fake.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

fake_playdate *fake_current;

static void *fake_realloc(void *block, size_t bytes) {
  if (bytes == 0) {
    if (block != NULL) fake_current->pages--;
    free(block);
    return NULL;
  }
  if (block == NULL) fake_current->pages++;
  if (bytes > fake_current->largest) fake_current->largest = bytes;
  return realloc(block, bytes);
}

static unsigned fake_seconds(unsigned *milliseconds) {
  if (milliseconds != NULL) *milliseconds = fake_current->milliseconds;
  return fake_current->seconds;
}

static unsigned fake_counter(void) { return fake_current->counter += 3; }

static void fake_log(const char *format, ...) {
  va_list args;
  va_start(args, format);
  vfprintf(stderr, format, args);
  fputc('\n', stderr);
  va_end(args);
}

/* ---- the input ---- */

static void fake_buttons(PDButtons *held, PDButtons *pushed, PDButtons *released) {
  *held = fake_current->buttons_held;
  *pushed = fake_current->buttons_pushed;
  *released = 0;
}

static float fake_crank_change(void) { return fake_current->crank; }
static int fake_crank_docked(void) { return fake_current->docked; }

static PDMenuItem *fake_add_menu_item(const char *title, PDMenuItemCallbackFunction *callback, void *userdata) {
  int i;
  for (i = 0; i < FAKE_MENU_ITEMS; i++) {
    fake_menu_item *item = &fake_current->menu[i];
    if (item->title[0] != '\0') continue;
    snprintf(item->title, sizeof item->title, "%s", title);
    item->callback = callback;
    item->ctx = userdata;
    return (PDMenuItem *)item;
  }
  return NULL;
}

static void fake_remove_menu_item(PDMenuItem *item) {
  int i;
  for (i = 0; i < FAKE_MENU_ITEMS; i++)
    if (item == (PDMenuItem *)&fake_current->menu[i]) fake_current->menu[i].title[0] = '\0';
}

static const fake_menu_item *menu_item(const fake_playdate *fake, const char *title) {
  int i;
  for (i = 0; i < FAKE_MENU_ITEMS; i++)
    if (fake->menu[i].title[0] != '\0' && strcmp(fake->menu[i].title, title) == 0) return &fake->menu[i];
  return NULL;
}

int fake_menu(fake_playdate *fake, const char *title) {
  const fake_menu_item *item = menu_item(fake, title);
  if (item == NULL) return 0;
  item->callback(item->ctx);
  return 1;
}

int fake_menu_holds(const fake_playdate *fake, const char *title) {
  return menu_item(fake, title) != NULL;
}

int fake_menu_count(const fake_playdate *fake) {
  int i, count = 0;
  for (i = 0; i < FAKE_MENU_ITEMS; i++) count += fake->menu[i].title[0] != '\0';
  return count;
}

static void fake_set_update(PDCallbackFunction *update, void *userdata) {
  fake_current->update = update;
  fake_current->update_ctx = userdata;
}

int fake_frame(fake_playdate *fake, PDButtons pushed, float crank) {
  int shown;
  fake_current = fake;
  if (fake->update == NULL) abort();
  fake_network_step(fake);
  fake->buttons_pushed = pushed;
  fake->buttons_held = pushed;
  fake->crank = crank;
  shown = fake->update(fake->update_ctx);
  fake->buttons_pushed = fake->buttons_held = 0;
  fake->crank = 0;
  return shown;
}

void fake_init(fake_playdate *fake, const char *data, const char *app) {
  memset(fake, 0, sizeof *fake);
  fake_current = fake;
  snprintf(fake->data, sizeof fake->data, "%s", data);
  snprintf(fake->app, sizeof fake->app, "%s", app);
  fake->seconds = 1000000;
  fake->sys.realloc = fake_realloc;
  fake->sys.getSecondsSinceEpoch = fake_seconds;
  fake->sys.getCurrentTimeMilliseconds = fake_counter;
  fake->sys.logToConsole = fake_log;
  fake->sys.error = fake_log;
  fake->sys.getButtonState = fake_buttons;
  fake->sys.getCrankChange = fake_crank_change;
  fake->sys.isCrankDocked = fake_crank_docked;
  fake->sys.setUpdateCallback = fake_set_update;
  fake->sys.addMenuItem = fake_add_menu_item;
  fake->sys.removeMenuItem = fake_remove_menu_item;
  fake_install_files(fake);
  fake_install_screen(fake);
  fake_install_bitmaps(fake);
  fake_install_sound(fake);
  fake_install_network(fake);
  fake->api.network = &fake->network;
  fake->api.system = &fake->sys;
  fake->api.file = &fake->file;
  fake->api.graphics = &fake->gfx;
  fake->api.sound = &fake->sound;
}
