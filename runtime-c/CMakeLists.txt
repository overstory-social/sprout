cmake_minimum_required(VERSION 3.16)
project(sprout_runtime C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

add_compile_options(-Wall -Wextra -Werror -pedantic)

set(SPROUT_MODULES
  arena budget bus catalogue catalogue_grammar catalogue_helpers catalogue_kinds draft draws
  effects engine-verbs eval exec exits graph guards hearing inflate intents json lists load move outcome range
  reading state status stored stored_check stored_write submit values wakes)

# The reading pass's areas, src/reading/<module>.c, each with test/reading_<module>.test.c.
set(SPROUT_READING_MODULES carried consent effect wildcards)

# The evaluator's areas, src/expr/<module>.c, each with test/expr_<module>.test.c.
set(SPROUT_EXPR_MODULES draws faults instances members names nodes operators passes range show spawn)

# The statements' areas, src/stmt/<module>.c, each with test/stmt_<module>.test.c.
set(SPROUT_STMT_MODULES each extension lifecycle links paths propose sends speech write)

set(SPROUT_SOURCES "")
foreach(module ${SPROUT_MODULES})
  list(APPEND SPROUT_SOURCES src/${module}.c)
endforeach()

foreach(module ${SPROUT_EXPR_MODULES})
  list(APPEND SPROUT_SOURCES src/expr/${module}.c)
endforeach()

foreach(module ${SPROUT_STMT_MODULES})
  list(APPEND SPROUT_SOURCES src/stmt/${module}.c)
endforeach()

foreach(module ${SPROUT_READING_MODULES})
  list(APPEND SPROUT_SOURCES src/reading/${module}.c)
endforeach()

add_library(sprout STATIC ${SPROUT_SOURCES})
target_include_directories(sprout PUBLIC include PRIVATE src)
target_link_libraries(sprout PUBLIC m)

# The desktop host: a fake clock, a seed from a script, a file of stored bytes, an emit that prints,
# and `sproutc`, which plays a cartridge's script through the public API. It may use libc; the library may not.
set(SPROUTC_MODULES cartridge evaluate host play readings)

set(SPROUTC_SOURCES "")
foreach(module ${SPROUTC_MODULES})
  list(APPEND SPROUTC_SOURCES host/${module}.c)
endforeach()

add_library(sproutc_host STATIC ${SPROUTC_SOURCES})
target_include_directories(sproutc_host PUBLIC host PRIVATE src)
target_link_libraries(sproutc_host PUBLIC sprout)

add_executable(sproutc host/sproutc.c)
target_link_libraries(sproutc PRIVATE sproutc_host)

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

foreach(module ${SPROUT_EXPR_MODULES})
  add_executable(expr_${module}.test test/expr_${module}.test.c)
  target_link_libraries(expr_${module}.test PRIVATE sprout)
  target_include_directories(expr_${module}.test PRIVATE src test)
  target_compile_definitions(expr_${module}.test PRIVATE
    SPROUT_GOLDENS="${CMAKE_CURRENT_SOURCE_DIR}/../corpus/goldens"
    SPROUT_CARTRIDGES="${SPROUT_CARTRIDGES_DIR}")
  add_test(NAME expr_${module} COMMAND expr_${module}.test)
  set_tests_properties(expr_${module} PROPERTIES FIXTURES_REQUIRED cartridges)
endforeach()

foreach(module ${SPROUT_STMT_MODULES})
  add_executable(stmt_${module}.test test/stmt_${module}.test.c)
  target_link_libraries(stmt_${module}.test PRIVATE sprout)
  target_include_directories(stmt_${module}.test PRIVATE src test)
  target_compile_definitions(stmt_${module}.test PRIVATE
    SPROUT_GOLDENS="${CMAKE_CURRENT_SOURCE_DIR}/../corpus/goldens"
    SPROUT_CARTRIDGES="${SPROUT_CARTRIDGES_DIR}")
  add_test(NAME stmt_${module} COMMAND stmt_${module}.test)
  set_tests_properties(stmt_${module} PROPERTIES FIXTURES_REQUIRED cartridges)
endforeach()

foreach(module ${SPROUT_READING_MODULES})
  add_executable(reading_${module}.test test/reading_${module}.test.c)
  target_link_libraries(reading_${module}.test PRIVATE sprout)
  target_include_directories(reading_${module}.test PRIVATE src test)
  target_compile_definitions(reading_${module}.test PRIVATE
    SPROUT_GOLDENS="${CMAKE_CURRENT_SOURCE_DIR}/../corpus/goldens"
    SPROUT_CARTRIDGES="${SPROUT_CARTRIDGES_DIR}")
  add_test(NAME reading_${module} COMMAND reading_${module}.test)
  set_tests_properties(reading_${module} PROPERTIES FIXTURES_REQUIRED cartridges)
endforeach()

foreach(module ${SPROUTC_MODULES})
  add_executable(${module}.host.test test/${module}.host.test.c)
  target_link_libraries(${module}.host.test PRIVATE sproutc_host)
  target_include_directories(${module}.host.test PRIVATE src test)
  target_compile_definitions(${module}.host.test PRIVATE
    SPROUT_GOLDENS="${CMAKE_CURRENT_SOURCE_DIR}/../corpus/goldens"
    SPROUT_CARTRIDGES="${SPROUT_CARTRIDGES_DIR}")
  add_test(NAME host-${module} COMMAND ${module}.host.test)
  set_tests_properties(host-${module} PROPERTIES FIXTURES_REQUIRED cartridges)
endforeach()
