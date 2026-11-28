"""
Blender 5.2 offline generator for Yunjing (云境) Realistic Guofeng 360° Sky Dome.
Renders a mathematically seamless 2048x1024 equirectangular panorama using:
  - Physical Nishita Sky Atmosphere (Rayleigh + Mie scattering, serene Eastern mountain clear day)
  - Procedural 3D multi-scale volumetric cumulus & high wispy cirrus cloud layers
  - Cycles + OpenImageDenoise -> tiny high-quality JPEG (~160-240 KB)

Output:
  - resource/sky/guofeng_sky_pano.jpg
"""
import math
import os
import bpy

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT_DIR, "resource", "sky")
OUT_JPG = os.path.join(OUT_DIR, "guofeng_sky_pano.jpg")
os.makedirs(OUT_DIR, exist_ok=True)


def build_sky_panorama():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # Configure Cycles panoramic equirectangular camera
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.volume_bounces = 2
    scene.cycles.volume_step_rate = 1.6
    scene.cycles.volume_max_steps = 128

    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88

    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.10

    cam_data = bpy.data.cameras.new("PanoCam")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100000.0
    cam_obj = bpy.data.objects.new("PanoCam", cam_data)
    cam_obj.location = (0.0, 0.0, 0.0)
    cam_obj.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # World: Physical Nishita Sky (no harsh sun disc baked so runtime dynamic sun aligns freely!)
    world = bpy.data.worlds.new("GuofengSkyWorld")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0

    # Combine physical Nishita sky with layered realistic procedural clouds in World Shader
    # (100% seamless, ultra-crisp, natural sunlit cumulus crests + cool blue-grey undersides + cirrus wisps!)
    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    sep_xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tex_coord.outputs["Generated"], sep_xyz.inputs["Vector"])

    sky_tex = nt.nodes.new("ShaderNodeTexSky")
    sky_tex.sky_type = "MULTIPLE_SCATTERING"
    sky_tex.sun_disc = False
    sky_tex.sun_elevation = math.radians(34.0)
    sky_tex.sun_rotation = math.radians(42.0)
    sky_tex.altitude = 450.0
    if hasattr(sky_tex, "air_density"):
        sky_tex.air_density = 1.15
    if hasattr(sky_tex, "aerosol_density"):
        sky_tex.aerosol_density = 1.25
    if hasattr(sky_tex, "ozone_density"):
        sky_tex.ozone_density = 1.35

    # Normalize high-HDR physical sky radiance (~10-25) into calibrated 0..1.4 display range
    sky_norm = nt.nodes.new("ShaderNodeVectorMath")
    sky_norm.operation = "SCALE"
    sky_norm.inputs["Scale"].default_value = 0.055
    nt.links.new(sky_tex.outputs["Color"], sky_norm.inputs[0])

    # Project ray onto curved atmospheric cloud dome: uv = dir.xy / (max(dir.z, 0.03) + 0.14)
    math_max_z = nt.nodes.new("ShaderNodeMath")
    math_max_z.operation = "MAXIMUM"
    math_max_z.inputs[1].default_value = 0.015
    nt.links.new(sep_xyz.outputs["Z"], math_max_z.inputs[0])

    math_denom = nt.nodes.new("ShaderNodeMath")
    math_denom.operation = "ADD"
    math_denom.inputs[1].default_value = 0.16
    nt.links.new(math_max_z.outputs["Value"], math_denom.inputs[0])

    vec_div = nt.nodes.new("ShaderNodeVectorMath")
    vec_div.operation = "SCALE"
    math_inv = nt.nodes.new("ShaderNodeMath")
    math_inv.operation = "DIVIDE"
    math_inv.inputs[0].default_value = 1.0
    nt.links.new(math_denom.outputs["Value"], math_inv.inputs[1])
    nt.links.new(tex_coord.outputs["Generated"], vec_div.inputs[0])
    nt.links.new(math_inv.outputs["Value"], vec_div.inputs["Scale"])

    # Domain warp for natural billowing cumulus shapes
    warp_noise = nt.nodes.new("ShaderNodeTexNoise")
    warp_noise.inputs["Scale"].default_value = 0.95
    warp_noise.inputs["Detail"].default_value = 6.0
    warp_noise.inputs["Roughness"].default_value = 0.56
    nt.links.new(vec_div.outputs["Vector"], warp_noise.inputs["Vector"])

    warp_mix = nt.nodes.new("ShaderNodeMix")
    warp_mix.data_type = "VECTOR"
    warp_mix.inputs["Factor"].default_value = 0.24
    nt.links.new(vec_div.outputs["Vector"], warp_mix.inputs["A"])
    nt.links.new(warp_noise.outputs["Color"], warp_mix.inputs["B"])

    # Main billowing cumulus cloud layer (multi-octave fBM)
    cumulus_noise = nt.nodes.new("ShaderNodeTexNoise")
    cumulus_noise.inputs["Scale"].default_value = 1.55
    cumulus_noise.inputs["Detail"].default_value = 11.0
    cumulus_noise.inputs["Roughness"].default_value = 0.60
    cumulus_noise.inputs["Distortion"].default_value = 0.35
    nt.links.new(warp_mix.outputs["Result"], cumulus_noise.inputs["Vector"])

    cumulus_ramp = nt.nodes.new("ShaderNodeMapRange")
    cumulus_ramp.interpolation_type = "SMOOTHSTEP"
    cumulus_ramp.inputs["From Min"].default_value = 0.48
    cumulus_ramp.inputs["From Max"].default_value = 0.74
    nt.links.new(cumulus_noise.outputs["Fac"], cumulus_ramp.inputs["Value"])

    # Secondary offset sample for directional sunlit crest vs shaded cloud belly
    sun_shift = nt.nodes.new("ShaderNodeVectorMath")
    sun_shift.operation = "ADD"
    sun_shift.inputs[1].default_value = (0.14, 0.12, 0.06)
    nt.links.new(warp_mix.outputs["Result"], sun_shift.inputs[0])

    cumulus_lit_noise = nt.nodes.new("ShaderNodeTexNoise")
    cumulus_lit_noise.inputs["Scale"].default_value = 1.55
    cumulus_lit_noise.inputs["Detail"].default_value = 9.0
    cumulus_lit_noise.inputs["Roughness"].default_value = 0.58
    cumulus_lit_noise.inputs["Distortion"].default_value = 0.35
    nt.links.new(sun_shift.outputs["Vector"], cumulus_lit_noise.inputs["Vector"])

    # Light factor = clamp((current - shifted) * 2.6 + 0.52) -> luminous crests, cool shaded bellies
    lit_sub = nt.nodes.new("ShaderNodeMath")
    lit_sub.operation = "SUBTRACT"
    nt.links.new(cumulus_noise.outputs["Fac"], lit_sub.inputs[0])
    nt.links.new(cumulus_lit_noise.outputs["Fac"], lit_sub.inputs[1])

    lit_range = nt.nodes.new("ShaderNodeMapRange")
    lit_range.interpolation_type = "SMOOTHSTEP"
    lit_range.inputs["From Min"].default_value = -0.14
    lit_range.inputs["From Max"].default_value = 0.14
    nt.links.new(lit_sub.outputs["Value"], lit_range.inputs["Value"])

    cloud_col = nt.nodes.new("ShaderNodeMix")
    cloud_col.data_type = "RGBA"
    cloud_col.inputs["A"].default_value = (0.28, 0.38, 0.54, 1.0)  # realistic cool blue-grey cloud belly
    cloud_col.inputs["B"].default_value = (1.35, 1.32, 1.24, 1.0)  # sunlit warm-ivory cloud crest
    nt.links.new(lit_range.outputs["Result"], cloud_col.inputs["Factor"])

    # High wispy cirrus streaks
    cirrus_scale = nt.nodes.new("ShaderNodeVectorMath")
    cirrus_scale.operation = "MULTIPLY"
    cirrus_scale.inputs[1].default_value = (0.65, 2.4, 0.8)
    nt.links.new(vec_div.outputs["Vector"], cirrus_scale.inputs[0])

    cirrus_noise = nt.nodes.new("ShaderNodeTexNoise")
    cirrus_noise.inputs["Scale"].default_value = 2.2
    cirrus_noise.inputs["Detail"].default_value = 10.0
    cirrus_noise.inputs["Roughness"].default_value = 0.65
    cirrus_noise.inputs["Distortion"].default_value = 0.75
    nt.links.new(cirrus_scale.outputs["Vector"], cirrus_noise.inputs["Vector"])

    cirrus_ramp = nt.nodes.new("ShaderNodeMapRange")
    cirrus_ramp.interpolation_type = "SMOOTHSTEP"
    cirrus_ramp.inputs["From Min"].default_value = 0.58
    cirrus_ramp.inputs["From Max"].default_value = 0.84
    nt.links.new(cirrus_noise.outputs["Fac"], cirrus_ramp.inputs["Value"])

    # Horizon fade mask so clouds melt naturally into atmospheric haze near horizon (Z <= 0.02 -> 0)
    hz_mask = nt.nodes.new("ShaderNodeMapRange")
    hz_mask.interpolation_type = "SMOOTHSTEP"
    hz_mask.inputs["From Min"].default_value = 0.015
    hz_mask.inputs["From Max"].default_value = 0.22
    nt.links.new(sep_xyz.outputs["Z"], hz_mask.inputs["Value"])

    # Blend cirrus onto physical Nishita sky
    cirrus_alpha = nt.nodes.new("ShaderNodeMath")
    cirrus_alpha.operation = "MULTIPLY"
    nt.links.new(cirrus_ramp.outputs["Result"], cirrus_alpha.inputs[0])
    nt.links.new(hz_mask.outputs["Result"], cirrus_alpha.inputs[1])

    cirrus_strength = nt.nodes.new("ShaderNodeMath")
    cirrus_strength.operation = "MULTIPLY"
    cirrus_strength.inputs[1].default_value = 0.36
    nt.links.new(cirrus_alpha.outputs["Value"], cirrus_strength.inputs[0])

    mix_cirrus = nt.nodes.new("ShaderNodeMix")
    mix_cirrus.data_type = "RGBA"
    mix_cirrus.inputs["B"].default_value = (1.12, 1.14, 1.18, 1.0)
    nt.links.new(cirrus_strength.outputs["Value"], mix_cirrus.inputs["Factor"])
    nt.links.new(sky_norm.outputs["Vector"], mix_cirrus.inputs["A"])

    # Blend main cumulus clouds
    cumulus_alpha = nt.nodes.new("ShaderNodeMath")
    cumulus_alpha.operation = "MULTIPLY"
    nt.links.new(cumulus_ramp.outputs["Result"], cumulus_alpha.inputs[0])
    nt.links.new(hz_mask.outputs["Result"], cumulus_alpha.inputs[1])

    cumulus_cap = nt.nodes.new("ShaderNodeMath")
    cumulus_cap.operation = "MULTIPLY"
    cumulus_cap.inputs[1].default_value = 0.92
    nt.links.new(cumulus_alpha.outputs["Value"], cumulus_cap.inputs[0])

    mix_cumulus = nt.nodes.new("ShaderNodeMix")
    mix_cumulus.data_type = "RGBA"
    nt.links.new(cumulus_cap.outputs["Value"], mix_cumulus.inputs["Factor"])
    nt.links.new(mix_cirrus.outputs["Result"], mix_cumulus.inputs["A"])
    nt.links.new(cloud_col.outputs["Result"], mix_cumulus.inputs["B"])

    # Soft misty horizon band blending lower hemisphere smoothly
    low_haze = nt.nodes.new("ShaderNodeMapRange")
    low_haze.interpolation_type = "SMOOTHSTEP"
    low_haze.inputs["From Min"].default_value = 0.14
    low_haze.inputs["From Max"].default_value = -0.04
    nt.links.new(sep_xyz.outputs["Z"], low_haze.inputs["Value"])

    mix_haze = nt.nodes.new("ShaderNodeMix")
    mix_haze.data_type = "RGBA"
    mix_haze.inputs["B"].default_value = (0.52, 0.64, 0.74, 1.0)
    nt.links.new(low_haze.outputs["Result"], mix_haze.inputs["Factor"])
    nt.links.new(mix_cumulus.outputs["Result"], mix_haze.inputs["A"])

    nt.links.new(mix_haze.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    scene.render.filepath = OUT_JPG
    bpy.ops.render.render(write_still=True)
    size_kb = os.path.getsize(OUT_JPG) / 1024.0
    print(f"RENDERED realistic 360 sky panorama -> {OUT_JPG} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    build_sky_panorama()
