# Minimal Makefile for Sphinx documentation
# Use: make html, make clean

SPHINXOPTS    =
SPHINXBUILD   = sphinx-build
SOURCEDIR     = .
BUILDDIR      = _build

html:
	$(SPHINXBUILD) -b html $(SOURCEDIR) $(BUILDDIR)/html $(SPHINXOPTS)
	@echo "Open $(BUILDDIR)/html/index.html in a browser."

clean:
	rm -rf $(BUILDDIR)

.PHONY: html clean
