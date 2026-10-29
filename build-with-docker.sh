# although we could use any path inside docker, using the same path as on the host
# allows the DWARF info (when building in DEBUG) to contain the correct file paths
DOCKER_WORKSPACE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "${DOCKER_WORKSPACE}/dist"
echo "PGLITE_VERSION=${PGLITE_VERSION}"
echo "DEBUG=${DEBUG}"
  
# electricsql/pglite-builder:6.0.5-1 \
docker run $@ \
  --rm \
  -e DEBUG=${DEBUG:-false} \
  -e PGLITE_VERSION=${PGLITE_VERSION} \
  --workdir=${DOCKER_WORKSPACE} \
  -v "${DOCKER_WORKSPACE}":"${DOCKER_WORKSPACE}":rw,z \
  -v "${DOCKER_WORKSPACE}/dist":/pglite:rw,z \
  electricsql/pglite-builder:3.1.74-7 \
  ./build-pglite.sh
