"""Every structured-output model the engine hands to the Anthropic SDK must be one the SDK can turn
into a JSON schema: an untyped property (`Any`) is rejected by the SDK before any call is made,
which silently sent every amended-clause re-read to the rules fallback."""

from __future__ import annotations

import pytest

from engine.extraction.extract import build_group_model
from engine.extraction.schema import TENDER_TYPES, compile_type
from engine.extraction.section_map import SectionMapOutput
from engine.extraction.tenderset.consolidate import amended_output_model
from engine.extraction.tenderset.read_set import ProseChangesOutput

transform_schema = pytest.importorskip("anthropic.lib._parse._transform").transform_schema


def test_fixed_output_models_are_accepted_by_the_sdk():
    for model in (SectionMapOutput, ProseChangesOutput):
        transform_schema(model)


def test_every_section_model_of_every_type_is_accepted_by_the_sdk():
    assert "cfd" in TENDER_TYPES
    for tender_type in TENDER_TYPES:
        schema = compile_type(tender_type)
        for section in schema.sections:
            fields = schema.fields_in(section.name)
            if fields:
                transform_schema(build_group_model(section.name, fields))


def test_amended_fields_model_is_accepted_by_the_sdk():
    for tender_type in ("fdre", "bess", "cfd"):
        schema = compile_type(tender_type)
        model = amended_output_model(list(schema.fields))
        transform_schema(model)
        assert set(model.model_fields) == {spec.key for spec in schema.fields}
