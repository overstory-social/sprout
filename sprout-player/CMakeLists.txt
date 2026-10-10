# sprout-player: the Playdate app. The C engine of ../runtime-c is the one source of the language;
# this folder adds the Lua UI and the glue that registers the engine's functions with the Lua
# runtime. Two targets, as the SDK's C_API examples build them:
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
# The runtime builds clean with -Werror in its own debug build. At -O2 a compiler reports warnings
# the debug build does not (a truncating strncpy into a zeroed buffer, a variable set on every
# path that returns), so the optimised builds of this app show them without failing.
target_compile_options(sprout PRIVATE -Wno-error)

if(TOOLCHAIN STREQUAL "armgcc")
  add_executable(${PLAYDATE_GAME_DEVICE} src/main.c)
  set(PLAYER_GAME ${PLAYDATE_GAME_DEVICE})
else()
  add_library(${PLAYDATE_GAME_NAME} SHARED src/main.c)
  set(PLAYER_GAME ${PLAYDATE_GAME_NAME})
endif()

include(${SDK}/C_API/buildsupport/playdate_game.cmake)

# Everything but the entry point, so the glue's tests link the same code the app runs.
set(PLAYER_SOURCES
  src/bridge.c src/budgets.c src/files.c src/pd_host.c src/reading_json.c src/reply.c
  src/savelog.c src/seen.c src/session.c src/text.c src/turns.c)
add_library(sprout_player_core STATIC ${PLAYER_SOURCES})
target_include_directories(sprout_player_core PUBLIC src PRIVATE ../runtime-c/src)
target_compile_definitions(sprout_player_core PUBLIC TARGET_EXTENSION=1)
target_compile_options(sprout_player_core PRIVATE -Wall -Wextra -Werror -pedantic)
target_link_libraries(sprout_player_core PUBLIC sprout)
target_link_libraries(${PLAYER_GAME} PRIVATE sprout_player_core)

# The tests need no device and no Simulator: the glue runs against a fake PlaydateAPI. The
# Simulator build only, since the fake is a native program.
if(NOT TOOLCHAIN STREQUAL "armgcc")
  enable_testing()
  set(PLAYER_CARTRIDGES "" CACHE PATH "Folder of packed corpus cartridges the glue's tests open")
  add_executable(player_glue_test test/glue.test.c test/fake_playdate.c)
  target_link_libraries(player_glue_test PRIVATE sprout_player_core)
  target_include_directories(player_glue_test PRIVATE test ../runtime-c/src)
  target_compile_definitions(player_glue_test PRIVATE PLAYER_CARTRIDGES="${PLAYER_CARTRIDGES}")
  add_test(NAME player-glue COMMAND player_glue_test)
  add_executable(player_units_test test/units.test.c test/fake_playdate.c)
  target_link_libraries(player_units_test PRIVATE sprout_player_core)
  target_include_directories(player_units_test PRIVATE test ../runtime-c/src)
  add_test(NAME player-units COMMAND player_units_test)

  find_program(PLAYER_LUA NAMES lua5.4 lua54 lua)
  if(PLAYER_LUA)
    add_test(NAME player-lua COMMAND ${PLAYER_LUA} ${CMAKE_CURRENT_SOURCE_DIR}/test/run.lua)
  endif()
endif()
