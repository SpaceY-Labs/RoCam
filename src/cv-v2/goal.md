Now, we need to revoluntionize the old YOLO detect pipeline, instead, we want a 10M parameter CNN architecture which the input is a masked image, and output is the traced object of the masked image, this way instead of tracing the rocket, we are tracing anything. 

1. input: input will be an input image with a mask, the mask masks the target, a target image. The output would be the mask of the masked target in the input image on the target image. 
2. architecture: backbone use YOLOv26, modified layers but keep the core architecture, perserve at least 4 layers of CNN, maintain a 10M params target, no more than 20M params. 
3. 
4. 