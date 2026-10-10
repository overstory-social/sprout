/* shipping.c: the signature check and the file digest Lua asks for, called as Lua calls them. */
#include "support.h"

#define SIGNATURE_2                                                                                                  \
  "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aee" \
  "b00d291612bb0c00"
#define KEY_2 "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"

/* The text of a fixture file, without its trailing newline. */
static char *fixture(const char *name, char *out, size_t size) {
  char path[600];
  FILE *file;
  size_t got;
  snprintf(path, sizeof path, "%s/%s", PLAYER_FIXTURES, name);
  file = fopen(path, "rb");
  CHECK(file != NULL, "the fixture %s", path);
  if (file == NULL) {
    out[0] = '\0';
    return out;
  }
  got = fread(out, 1, size - 1, file);
  fclose(file);
  while (got > 0 && out[got - 1] == '\n') got--;
  out[got] = '\0';
  return out;
}

static void the_signature_node_made_over_an_index_verifies_here(void) {
  static char canonical[4096], signature[200], key[100], tampered[4096];
  char *reply;
  begin_bridge("fixture");
  fixture("index.canonical.txt", canonical, sizeof canonical);
  fixture("index.signature.txt", signature, sizeof signature);
  snprintf(key, sizeof key, "%s", "");
  {
    char path[600];
    FILE *file;
    snprintf(path, sizeof path, "%s/../index-test.pub", PLAYER_FIXTURES);
    file = fopen(path, "rb");
    CHECK(file != NULL, "the test public key");
    if (file != NULL) {
      size_t got = fread(key, 1, sizeof key - 1, file);
      fclose(file);
      while (got > 0 && key[got - 1] == '\n') got--;
      key[got] = '\0';
    }
  }
  reply = call3("sprout.verify", canonical, signature, key);
  CHECK(HAS(reply, "\"ok\":true"), "the signed index text: %s", reply);
  snprintf(tampered, sizeof tampered, "%s", canonical);
  tampered[strlen("[{\"assets\":[{\"bytes\":8")] = '1';
  reply = call3("sprout.verify", tampered, signature, key);
  CHECK(HAS(reply, "\"ok\":false"), "one digit of a size changed: %s", reply);
  end();
}

static void the_published_signature_is_accepted_and_a_changed_text_is_refused(void) {
  char *reply;
  begin_bridge("verify");
  /* RFC 8032 section 7.1, test 2: the message is the single byte 0x72, the letter r. */
  reply = call3("sprout.verify", "r", SIGNATURE_2, KEY_2);
  CHECK(HAS(reply, "\"ok\":true"), "%s", reply);
  reply = call3("sprout.verify", "s", SIGNATURE_2, KEY_2);
  CHECK(HAS(reply, "\"ok\":false") && HAS(reply, "is not the one the key makes for this text"), "%s", reply);
  reply = call3("sprout.verify", "", SIGNATURE_2, KEY_2);
  CHECK(HAS(reply, "\"ok\":false"), "an empty text: %s", reply);
  end();
}

static void a_signature_or_key_that_is_not_hexadecimal_of_the_right_length_is_refused_in_words(void) {
  char *reply, not_hex[sizeof SIGNATURE_2];
  begin_bridge("hex");
  reply = call3("sprout.verify", "r", "92a0", KEY_2);
  CHECK(HAS(reply, "\"ok\":false") && HAS(reply, "128 hexadecimal digits"), "%s", reply);
  reply = call3("sprout.verify", "r", SIGNATURE_2, "3d40");
  CHECK(HAS(reply, "\"ok\":false") && HAS(reply, "64 hexadecimal digits"), "%s", reply);
  memcpy(not_hex, SIGNATURE_2, sizeof SIGNATURE_2);
  not_hex[0] = 'z';
  reply = call3("sprout.verify", "r", not_hex, KEY_2);
  CHECK(HAS(reply, "\"ok\":false") && HAS(reply, "128 hexadecimal digits"), "%s", reply);
  reply = call3("sprout.verify", NULL, NULL, NULL);
  CHECK(HAS(reply, "\"ok\":false"), "no arguments at all: %s", reply);
  end();
}

static void a_file_in_the_data_folder_has_its_sha256_and_size_told(void) {
  char *reply;
  begin_bridge("digest");
  write_text("abc.txt", "abc");
  reply = call("sprout.digest", "abc.txt");
  CHECK(HAS(reply, "\"ok\":true") &&
            HAS(reply, "\"sha256\":\"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\"") &&
            HAS(reply, "\"bytes\":3"),
        "%s", reply);
  write_text("empty.txt", "");
  reply = call("sprout.digest", "empty.txt");
  CHECK(HAS(reply, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") && HAS(reply, "\"bytes\":0"),
        "%s", reply);
  reply = call("sprout.digest", "absent.txt");
  CHECK(HAS(reply, "\"ok\":false") && HAS(reply, "cannot be read"), "%s", reply);
  end();
}

static void a_cartridge_in_the_app_folder_is_digested_too(void) {
  char *reply = NULL;
  begin_bridge("app");
  reply = call("sprout.digest", "chip-tree.sproutworld");
  CHECK(HAS(reply, "\"ok\":true") && HAS(reply, "\"sha256\":\""), "%s", reply);
  end();
}

int main(void) {
  test_program("shipping");
  the_published_signature_is_accepted_and_a_changed_text_is_refused();
  the_signature_node_made_over_an_index_verifies_here();
  a_signature_or_key_that_is_not_hexadecimal_of_the_right_length_is_refused_in_words();
  a_file_in_the_data_folder_has_its_sha256_and_size_told();
  a_cartridge_in_the_app_folder_is_digested_too();
  return finish();
}
