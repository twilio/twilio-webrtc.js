#!/bin/bash
set -ev
echo PWD=$PWD
if [ "${TRAVIS_OS_NAME}" == 'linux' ]; then
  # Upgrade to dpkg >= 1.17.5ubuntu5.8, which fixes
  # https://bugs.launchpad.net/ubuntu/+source/dpkg/+bug/1730627
  # (https://github.com/travis-ci/travis-ci/issues/9361)
  sudo apt-get install -y dpkg
fi
npm run build
