import { _decorator, RenderStage, GFXRect, GFXFramebuffer, GFXColor, GFXCommandBuffer, ForwardPipeline, RenderView, ModelComponent, Material, renderer, PipelineStateManager, GFXRenderPass, GFXFormat, GFXLoadOp, GFXStoreOp, GFXTextureLayout, GFXShaderStageFlagBit, GFXDescriptorType, pipeline, GFXType, GFXFilter, GFXAddress, RenderFlow, RenderPipeline, director, Vec4, GFXBufferUsageBit, GFXMemoryUsageBit, GFXClearFlag } from "cc";
import { GrassBender } from "../../src/grass/grass-bender";
import { createFrameBuffer } from "../utils/frame-buffer";
import { GrassBenderRenderer } from "../../src/grass/grass-bender-renderer";
const { ccclass, type } = _decorator;
const { SetIndex } = pipeline;


const tempVec4 = new Vec4;

const colors: GFXColor[] = [{ r: 1, g: 1, b: 1, a: 1 }];
const bufs: GFXCommandBuffer[] = [];

const UNIFORM_GRASS_BEND_MAP = {
    stageFlags: GFXShaderStageFlagBit.FRAGMENT, descriptorType: GFXDescriptorType.SAMPLER, count: 1,
    set: SetIndex.GLOBAL, binding: 4, name: 'cc_grass_bend_map', type: GFXType.SAMPLER2D,
};
pipeline.globalDescriptorSetLayout.record[UNIFORM_GRASS_BEND_MAP.name] = UNIFORM_GRASS_BEND_MAP;
pipeline.globalDescriptorSetLayout.bindings[UNIFORM_GRASS_BEND_MAP.binding] = UNIFORM_GRASS_BEND_MAP;

export class UBOGrassBend {
    public static GrassBendUVOffset: number = 0;
    public static COUNT: number = UBOGrassBend.GrassBendUVOffset + 4;
    public static SIZE: number = UBOGrassBend.COUNT * 4;

    public static BLOCK = {
        stageFlags: GFXShaderStageFlagBit.ALL, descriptorType: GFXDescriptorType.UNIFORM_BUFFER, count: 1,
        set: SetIndex.GLOBAL, binding: 5, name: 'CCGrassBend', members: [
            { name: 'cc_grass_bend_uv', type: GFXType.FLOAT4, count: 1 },
        ],
    };
}
pipeline.globalDescriptorSetLayout.record[UBOGrassBend.BLOCK.name] = UBOGrassBend.BLOCK;
pipeline.globalDescriptorSetLayout.bindings[UBOGrassBend.BLOCK.binding] = UBOGrassBend.BLOCK;

pipeline.bindingMappingInfo.samplerOffsets[1] += 2;
pipeline.bindingMappingInfo.samplerOffsets[2] += 2;

const _samplerInfo = [
    GFXFilter.LINEAR,
    GFXFilter.LINEAR,
    GFXFilter.NONE,
    GFXAddress.CLAMP,
    GFXAddress.CLAMP,
    GFXAddress.CLAMP,
];


@ccclass("GrassBendRenderStage")
export class GrassBendRenderStage extends RenderStage {
    static get instance (): GrassBendRenderStage {
        let flow = director.root.pipeline.flows.find(f => f.name === 'ForwardFlow');
        if (!flow) return null;
        return flow.stages.find(s => s.name === 'GrassBendRenderStage') as GrassBendRenderStage;
    }

    _name = 'GrassBendRenderStage'

    private _frameBuffer: GFXFramebuffer | null = null;
    private _renderArea: GFXRect = { x: 0, y: 0, width: 0, height: 0 };

    private _renderPass: GFXRenderPass = null;

    private _grassBendRenderer: GrassBenderRenderer = null;

    protected _bendUBO = new Float32Array(UBOGrassBend.COUNT);

    @type(Material)
    _material: Material = null;
    @type(Material)
    get material () {
        return this._material;
    }
    set material (v) {
        this._material = v;
    }

    grassBenders: GrassBender[] = [];

    activate (pipeline: RenderPipeline, flow: RenderFlow) {
        super.activate(pipeline, flow);

        this.updateUBO();
    }

    addGrassBender (bender: GrassBender) {
        this.grassBenders.push(bender);
    }

    removeGrassBender (bender: GrassBender) {
        let index = this.grassBenders.indexOf(bender);
        if (index === -1) return;
        this.grassBenders.splice(index, 1);
    }

    setGrassBendRenderer (renderer: GrassBenderRenderer) {
        this._grassBendRenderer = renderer;
    }

    updateUBO () {
        const pipeline = this._pipeline as ForwardPipeline;
        const device = pipeline.device;

        if (!this._frameBuffer) {
            if (!this._renderPass) {
                if (!this._renderPass) {
                    this._renderPass = device.createRenderPass({
                        colorAttachments: [{
                            format: GFXFormat.RGBA32F,
                            loadOp: GFXLoadOp.CLEAR, // should clear color attachment
                            storeOp: GFXStoreOp.STORE,
                            sampleCount: 1,
                            beginLayout: GFXTextureLayout.UNDEFINED,
                            endLayout: GFXTextureLayout.PRESENT_SRC,
                        }],
                        depthStencilAttachment: {
                            format: device.depthStencilFormat,
                            depthLoadOp: GFXLoadOp.CLEAR,
                            depthStoreOp: GFXStoreOp.STORE,
                            stencilLoadOp: GFXLoadOp.CLEAR,
                            stencilStoreOp: GFXStoreOp.STORE,
                            sampleCount: 1,
                            beginLayout: GFXTextureLayout.UNDEFINED,
                            endLayout: GFXTextureLayout.DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
                        },
                    });
                }
            }

            this._frameBuffer = createFrameBuffer(this._renderPass, this._pipeline, device, true, 512, 512);
            const shadowMapSamplerHash = renderer.genSamplerHash(_samplerInfo);
            const shadowMapSampler = renderer.samplerLib.getSampler(device, shadowMapSamplerHash);
            pipeline.descriptorSet.bindSampler(UNIFORM_GRASS_BEND_MAP.binding, shadowMapSampler);
            pipeline.descriptorSet.bindTexture(UNIFORM_GRASS_BEND_MAP.binding, this._frameBuffer.colorTextures[0]);
        }

        if (this._grassBendRenderer) {
            let texture = this._frameBuffer.colorTextures[0]
            let resolution = this._grassBendRenderer.resolution;
            if (texture.width !== resolution || texture.height !== resolution) {
                texture.resize(resolution, resolution);
                this._frameBuffer.depthStencilTexture.resize(resolution, resolution);
            }

            let bendRenderer = this._grassBendRenderer;
            let pos = this._grassBendRenderer.renderCamera.node.worldPosition;
            tempVec4.set(
                pos.x,
                pos.z,
                bendRenderer.range * 2,
                1
            )
            Vec4.toArray(this._bendUBO, tempVec4, UBOGrassBend.GrassBendUVOffset);
        }

        let buffer = pipeline.descriptorSet.getBuffer(UBOGrassBend.BLOCK.binding);
        if (!buffer) {
            buffer = pipeline.device.createBuffer({
                usage: GFXBufferUsageBit.UNIFORM | GFXBufferUsageBit.TRANSFER_DST,
                memUsage: GFXMemoryUsageBit.HOST | GFXMemoryUsageBit.DEVICE,
                size: UBOGrassBend.SIZE,
            });
            pipeline.descriptorSet.bindBuffer(UBOGrassBend.BLOCK.binding, buffer);
        }
        buffer.update(this._bendUBO);
    }

    render (view: RenderView) {
        if (!this._material || !this._grassBendRenderer) {
            return;
        }
        if (view.camera.node !== this._grassBendRenderer.renderCamera.node) {
            return;
        }

        this.updateUBO();

        const pipeline = this._pipeline as ForwardPipeline;
        const shadowInfo = pipeline.shadows;
        const device = pipeline.device;
        const camera = view.camera;

        // command buffer
        const cmdBuff = pipeline.commandBuffers[0];

        const vp = camera.viewport;
        const shadowMapSize = shadowInfo.size;
        this._renderArea!.x = vp.x * shadowMapSize.x;
        this._renderArea!.y = vp.y * shadowMapSize.y;
        this._renderArea!.width = vp.width * shadowMapSize.x * pipeline.shadingScale;
        this._renderArea!.height = vp.height * shadowMapSize.y * pipeline.shadingScale;

        const renderPass = this._frameBuffer!.renderPass;

        colors[0].r = camera.clearColor.r;
        colors[0].g = camera.clearColor.g;
        colors[0].b = camera.clearColor.b;
        colors[0].a = camera.clearColor.a;

        cmdBuff.begin();
        cmdBuff.beginRenderPass(renderPass, this._frameBuffer!, this._renderArea!,
            colors, camera.clearDepth, camera.clearStencil);

        cmdBuff.bindDescriptorSet(SetIndex.GLOBAL, pipeline.descriptorSet);

        let pass = this._material.passes[0];
        let hPass = pass.handle;

        const grassBenders = this.grassBenders;
        let m = 0; let p = 0;
        for (let i = 0; i < grassBenders.length; ++i) {
            const ro = grassBenders[i].getComponent(ModelComponent);
            const subModels = ro.model.subModels;
            for (m = 0; m < subModels.length; m++) {
                const subModel = subModels[m];
                
                let grassBendStartIdx = subModel.passes.indexOf(pass);
                if (grassBendStartIdx === -1) {
                    grassBendStartIdx = subModel.passes.length;
                    subModel.passes.push(pass);
                    (subModel as any)._flushPassInfo();
                }

                const shaderHandle = renderer.SubModelPool.get(subModel.handle, renderer.SubModelView.SHADER_0 + grassBendStartIdx);
                const shader = renderer.ShaderPool.get(shaderHandle as any);
                if (!shader) {
                    continue;
                }
                
                const ia = subModel.inputAssembler;
                const pso = PipelineStateManager.getOrCreatePipelineState(device, hPass, shader, renderPass, ia);

                const descriptorSet = renderer.DSPool.get(renderer.PassPool.get(hPass, renderer.PassView.DESCRIPTOR_SET));
                cmdBuff.bindPipelineState(pso);
                cmdBuff.bindDescriptorSet(SetIndex.MATERIAL, descriptorSet);
                cmdBuff.bindDescriptorSet(SetIndex.LOCAL, subModel.descriptorSet);
                cmdBuff.bindInputAssembler(ia);
                cmdBuff.draw(ia);
            }
        }

        cmdBuff.endRenderPass();
        cmdBuff.end();

        bufs[0] = cmdBuff;
        device.queue.submit(bufs);
    }

    rebuild () {
        if (this._frameBuffer) {
            this._frameBuffer.destroy();
        }
        this._frameBuffer = null;
    }
    resize () {
    }
    destroy () {
        this.rebuild();
    }
}
