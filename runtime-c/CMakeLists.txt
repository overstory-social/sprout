cmake_minimum_required(VERSION 3.16)
project(sprout_runtime C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

add_compile_options(-Wall -Wextra -Werror -pedantic)

set(SPROUT_MODULES
  arena budget cartridge catalogue catalogue_grammar catalogue_helpers catalogue_kinds draft draws
  graph inflate json lists state status stored stored_check stored_write values)

set(SPROUT_SOURCES "")
foreach(module ${SPROUT_MODULES})
  list(APPEND SPROUT_SOURCES src/${module}.c)
endforeach()

add_library(sprout STATIC ${SPROUT_SOURCES})
target_include_directories(sprout PUBLIC include PRIVATE src)
target_link_libraries(sprout PUBLIC m)

enable_testing()

# Every corpus world packed as a cartridge, once, for the tests that load them.
find_program(SPROUT_NODE node)
set(SPROUT_CARTRIDGES_DIR ${CMAKE_CURRENT_BINARY_DIR}/cartridges)
if(SPROUT_NODE)
  add_test(NAME corpus-cartridges
           COMMAND ${SPROUT_NODE} ${CMAKE_CURRENT_SOURCE_DIR}/test/pack-corpus.mjs ${SPROUT_CARTRIDGES_DIR})
else()
  add_test(NAME corpus-cartridges COMMAND ${CMAKE_COMMAND} -E false)
endif()
set_tests_properties(corpus-cartridges PROPERTIES FIXTURES_SETUP cartridges)

foreach(module ${SPROUT_MODULES})
  add_executable(${module}.test test/${module}.test.c)
  target_link_libraries(${module}.test PRIVATE sprout)
  target_include_directories(${module}.test PRIVATE src test)
  target_compile_definitions(${module}.test PRIVATE
    SPROUT_GOLDENS="${CMAKE_CURRENT_SOURCE_DIR}/../corpus/goldens"
    SPROUT_CARTRIDGES="${SPROUT_CARTRIDGES_DIR}")
  add_test(NAME ${module} COMMAND ${module}.test)
  set_tests_properties(${module} PROPERTIES FIXTURES_REQUIRED cartridges)
endforeach()
