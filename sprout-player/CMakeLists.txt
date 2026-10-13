# sprout-player: the Playdate app, pure C. The C engine of ../runtime-c is the one source of the
# language; this folder adds the session over it, the host adapter (src/host) and the screens (src/ui).
# Two targets, as the SDK's C_API examples build them:
#
#   Simulator (the default)   a native shared library the Simulator loads, and the pdx
#   device                    -DCMAKE_TOOLCHAIN_FILE=$PLAYDATE_SDK_PATH/C_API/buildsupport/arm.cmake
#                             -DTOOLCHAIN=armgcc, which needs arm-none-eabi-gcc
#
# `scripts/playdate-player.mjs` runs both for you (npm run playdate).
cmake_minimum_required(VERSION 3.19)
set(CMAKE_C_STANDARD 11)

set(ENVSDK $ENV{PLAYDATE_SDK_PATH})
if(NOT "${ENVSDK}" STREQUAL "")
  file(TO_CMAKE_PATH "${ENVSDK}" SDK)
else()
  execute_process(
    COMMAND bash -c "egrep '^\\s*SDKRoot' $HOME/.Playdate/config"
    COMMAND head -n 1
    COMMAND cut -c9-
    OUTPUT_VARIABLE SDK
    OUTPUT_STRIP_TRAILING_WHITESPACE)
endif()
if(NOT EXISTS "${SDK}")
  message(FATAL_ERROR "The Playdate SDK was not found: set PLAYDATE_SDK_PATH (scripts/playdate-sdk.sh fetches it).")
endif()

set(CMAKE_CONFIGURATION_TYPES "Debug;Release")

set(PLAYDATE_GAME_NAME sprout-player)
set(PLAYDATE_GAME_DEVICE sprout-player_DEVICE)
project(${PLAYDATE_GAME_NAME} C ASM)

# The pdx is built beside the build tree, not into the checkout.
if(NOT DEFINED PRODUCT_DIR)
  set(PRODUCT_DIR ${CMAKE_BINARY_DIR} CACHE STRING "Built PDX directory")
endif()

# The runtime is a static library inside the game's binary, so it is position independent for the
# Simulator's shared library, and on the device it is built for the same core as the game.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(TOOLCHAIN STREQUAL "armgcc")
  set(DEVICE_FLAGS "-mthumb -mcpu=cortex-m7 -mfloat-abi=hard -mfpu=fpv5-sp-d16 -D__FPU_USED=1 -falign-functions=16 -fomit-frame-pointer -ffunction-sections -fdata-sections -mword-relocations -fno-common -O2")
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${DEVICE_FLAGS}")
endif()

set(SPROUT_RUNTIME_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(../runtime-c ${CMAKE_BINARY_DIR}/runtime-c)
if(TOOLCHAIN STREQUAL "armgcc")
  add_executable(${PLAYDATE_GAME_DEVICE} src/main.c)
  set(PLAYER_GAME ${PLAYDATE_GAME_DEVICE})
else()
  add_library(${PLAYDATE_GAME_NAME} SHARED src/main.c)
  set(PLAYER_GAME ${PLAYDATE_GAME_NAME})
endif()

include(${SDK}/C_API/buildsupport/playdate_game.cmake)

# Everything but the entry point, so the tests link the same code the app runs.
set(PLAYER_SOURCES
  src/budgets.c src/canonical.c src/ed25519.c src/host/files.c src/host/net.c src/host/pd_host.c
  src/host/stack.c src/savelog.c src/seen.c src/session.c src/shipping.c
  src/signed_index.c src/text.c src/told.c src/turns.c src/ui/app.c src/ui/arrival.c src/ui/builder.c src/ui/clock.c
  src/ui/downloads.c src/ui/drum.c src/ui/gallery.c src/ui/images.c src/ui/message.c src/ui/nickname.c src/ui/pen.c
  src/ui/pictures.c src/ui/reader.c src/ui/sentence.c src/ui/shelf.c src/ui/sound.c src/ui/transcript.c src/ui/wrap.c)

# The publisher's public key, whose signature the download screen requires on the index of worlds,
# baked in as generated/publickey.h. scripts/playdate-player.mjs names the file it reads
# (SPROUT_INDEX_PUBLIC_KEY, else the test key, whose private half is in the repository).
set(PLAYER_INDEX_PUBLIC_KEY_FILE "${CMAKE_CURRENT_SOURCE_DIR}/test/index-test.pub" CACHE FILEPATH
  "The file holding the index's public key as 64 hexadecimal digits")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${PLAYER_INDEX_PUBLIC_KEY_FILE}")
file(READ "${PLAYER_INDEX_PUBLIC_KEY_FILE}" PLAYER_INDEX_PUBLIC_KEY)
string(STRIP "${PLAYER_INDEX_PUBLIC_KEY}" PLAYER_INDEX_PUBLIC_KEY)
if(NOT PLAYER_INDEX_PUBLIC_KEY MATCHES "^[0-9a-f]+$")
  message(FATAL_ERROR "${PLAYER_INDEX_PUBLIC_KEY_FILE} should hold the public key as 64 lowercase hexadecimal digits.")
endif()
string(LENGTH "${PLAYER_INDEX_PUBLIC_KEY}" PLAYER_INDEX_PUBLIC_KEY_LENGTH)
if(NOT PLAYER_INDEX_PUBLIC_KEY_LENGTH EQUAL 64)
  message(FATAL_ERROR "${PLAYER_INDEX_PUBLIC_KEY_FILE} should hold the public key as 64 lowercase hexadecimal digits.")
endif()
file(CONFIGURE OUTPUT "${CMAKE_BINARY_DIR}/generated/publickey.h" CONTENT
  "/* Generated from @PLAYER_INDEX_PUBLIC_KEY_FILE@ when the build was configured: the Ed25519 public key whose\n * signature the download screen requires on the index of worlds. Not committed. */\n#define PLAYER_INDEX_PUBLIC_KEY \"@PLAYER_INDEX_PUBLIC_KEY@\"\n"
  @ONLY)

add_library(sprout_player_core STATIC ${PLAYER_SOURCES})
target_include_directories(sprout_player_core PUBLIC src PRIVATE ../runtime-c/src ${CMAKE_BINARY_DIR}/generated)
target_compile_definitions(sprout_player_core PUBLIC TARGET_EXTENSION=1)
if(TOOLCHAIN STREQUAL "armgcc")
  target_compile_definitions(sprout_player_core PUBLIC PLAYER_DEVICE=1)
endif()
target_compile_options(sprout_player_core PRIVATE -Wall -Wextra -Werror -pedantic)
target_link_libraries(sprout_player_core PUBLIC sprout)
target_link_libraries(${PLAYER_GAME} PRIVATE sprout_player_core)
target_include_directories(${PLAYER_GAME} PRIVATE ../runtime-c/src)

# The tests need no device and no Simulator: the app runs against a fake PlaydateAPI. The
# Simulator build only, since the fake is a native program.
if(NOT TOOLCHAIN STREQUAL "armgcc")
  enable_testing()
  set(PLAYER_CARTRIDGES "" CACHE PATH "Folder of packed corpus cartridges the tests open")
  # One test program for each module of src/, beside the session played end to end.
  add_library(player_test_support STATIC test/support.c test/fake_playdate.c)
  target_link_libraries(player_test_support PUBLIC sprout_player_core)
  target_include_directories(player_test_support PUBLIC test ../runtime-c/src)
  target_compile_definitions(player_test_support PUBLIC PLAYER_CARTRIDGES="${PLAYER_CARTRIDGES}"
    PLAYER_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  set(PLAYER_TESTS text ed25519 shipping shipped files stack pd_host budgets told savelog session turns seen played
    wrap transcript ui builder gallery pictures sound canonical signed_index shelf nickname clock net downloads)
  foreach(name ${PLAYER_TESTS})
    add_executable(player_${name}_test test/${name}.test.c)
    target_link_libraries(player_${name}_test PRIVATE player_test_support)
    add_test(NAME player-${name} COMMAND player_${name}_test)
  endforeach()
  # The screens' test drives the app through its entry point.
  target_sources(player_ui_test PRIVATE src/main.c)
endif()
