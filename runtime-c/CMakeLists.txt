cmake_minimum_required(VERSION 3.16)
project(sprout_runtime C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

add_compile_options(-Wall -Wextra -Werror -pedantic)

set(SPROUT_MODULES arena budget draws json lists status values)

set(SPROUT_SOURCES "")
foreach(module ${SPROUT_MODULES})
  list(APPEND SPROUT_SOURCES src/${module}.c)
endforeach()

add_library(sprout STATIC ${SPROUT_SOURCES})
target_include_directories(sprout PUBLIC include PRIVATE src)
target_link_libraries(sprout PUBLIC m)

enable_testing()

foreach(module ${SPROUT_MODULES})
  add_executable(${module}.test test/${module}.test.c)
  target_link_libraries(${module}.test PRIVATE sprout)
  target_include_directories(${module}.test PRIVATE src test)
  add_test(NAME ${module} COMMAND ${module}.test)
endforeach()
